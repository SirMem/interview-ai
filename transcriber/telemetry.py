"""
OpenTelemetry → Grafana Cloud (OTLP HTTP) — fully async, never blocks the hot path.

Two surfaces:
  - meter (metrics): histograms / counters / gauges, batched every 10 s
  - logger (logs):   structured records, BatchLogRecordProcessor with bounded queue

Two activation modes:
  - telemetry.enabled = false → all calls are no-ops; one console warning at boot
  - Grafana unreachable        → OTel retry/backoff; bounded queue drops oldest

Public API:
  init_telemetry(config)        — call from main.py lifespan startup
  shutdown_telemetry()          — call from main.py lifespan shutdown (graceful flush)
  log(event, level='INFO', **f) — same signature as the old log_writer.log()

  HISTOGRAMS / COUNTERS / GAUGES exposed as module-level handles. See bottom of file.

Service name: f"{service_prefix}.transcriber" (default: solvewatch.transcriber)
"""
from __future__ import annotations

import logging
import os
import platform
import socket
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from opentelemetry.sdk._logs import LoggingHandler

logger = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

_enabled: bool = False
_meter = None
_otel_logger = None
_meter_provider = None
_logger_provider = None
_logging_bridge = None   # LoggingHandler bridging stdlib WARNING+ → OTel
_init_lock = threading.Lock()

# Service identity, set at init time
_service_name = "solvewatch.transcriber"

# Public metric handles — populated by init_telemetry().
# When telemetry is disabled, these stay as no-op shims so call sites don't branch.
HIST_VAD_LATENCY_MS:        Any = None
HIST_WHISPER_DECODE_MS:     Any = None
HIST_SPEAKER_ID_LATENCY_MS: Any = None
HIST_SILENCE_WAIT_ACTUAL_MS: Any = None

COUNT_UTTERANCES_DETECTED:  Any = None
COUNT_UTTERANCES_PASSED:    Any = None
COUNT_UTTERANCES_DISCARDED: Any = None

GAUGE_LISTENER_ACTIVE:        Any = None
GAUGE_SPEAKER_ID_MODEL_STATUS: Any = None
GAUGE_WHISPER_MODEL_LOADED:    Any = None

# System-resource gauges (populated by the periodic sampler).
GAUGE_HOST_CPU_PERCENT:        Any = None
GAUGE_HOST_MEMORY_PERCENT:     Any = None
GAUGE_HOST_MEMORY_USED_BYTES:  Any = None
GAUGE_PROCESS_CPU_PERCENT:     Any = None
GAUGE_PROCESS_MEMORY_RSS_BYTES: Any = None
GAUGE_GPU_UTILIZATION_PERCENT: Any = None
GAUGE_GPU_MEMORY_USED_BYTES:   Any = None

# Sampler thread state
_sampler_thread: Optional[threading.Thread] = None
_sampler_running: bool = False
_sampler_interval_s: float = 10.0

# Host-identity labels — populated by init_telemetry(), used by sampler + callers.
# Mirrors Node.js _hostLabels: Grafana Cloud doesn't promote resource attrs to
# metric labels, so we attach them explicitly on every instrument record.
_host_labels: Dict[str, Any] = {}


def get_host_labels() -> Dict[str, Any]:
    """Return a copy of the host-identity labels for use as metric attributes."""
    return dict(_host_labels)


# ── No-op shims (used when disabled) ──────────────────────────────────────────

class _NoopHistogram:
    def record(self, value, attributes=None): pass

class _NoopCounter:
    def add(self, value, attributes=None): pass

class _NoopGauge:
    def set(self, value, attributes=None): pass

_NOOP_HIST  = _NoopHistogram()
_NOOP_COUNT = _NoopCounter()
_NOOP_GAUGE = _NoopGauge()


# ── Resource attribute discovery (multi-machine identity) ────────────────────

def _macos_hardware_model() -> str:
    """Return the Mac model identifier (e.g. 'MacBookPro18,4'). Empty on error."""
    try:
        out = subprocess.check_output(
            ['sysctl', '-n', 'hw.model'], timeout=2, stderr=subprocess.DEVNULL,
        ).decode().strip()
        return out
    except Exception:
        return ''


def _macos_cpu_brand() -> str:
    try:
        out = subprocess.check_output(
            ['sysctl', '-n', 'machdep.cpu.brand_string'], timeout=2, stderr=subprocess.DEVNULL,
        ).decode().strip()
        return out
    except Exception:
        return ''


def _stable_host_id() -> str:
    """A stable per-machine ID so the same physical box reports identically
    across reboots and across services. Falls back to MAC-based UUID.

    macOS:  IOPlatformUUID via ioreg
    Linux:  /etc/machine-id (or /var/lib/dbus/machine-id)
    Other:  hash of MAC address from uuid.getnode()
    """
    try:
        if sys.platform == 'darwin':
            out = subprocess.check_output(
                ['ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'],
                timeout=2, stderr=subprocess.DEVNULL,
            ).decode()
            for line in out.splitlines():
                if 'IOPlatformUUID' in line:
                    parts = line.split('=')
                    if len(parts) > 1:
                        return parts[1].strip().strip('"')
        elif sys.platform.startswith('linux'):
            for path in ('/etc/machine-id', '/var/lib/dbus/machine-id'):
                try:
                    with open(path, 'r') as f:
                        v = f.read().strip()
                        if v:
                            return v
                except Exception:
                    pass
    except Exception:
        pass
    # Fallback — MAC address (uuid.getnode) is stable on a given NIC.
    return str(uuid.UUID(int=uuid.getnode())).replace('-', '')


def _gpu_info() -> Dict[str, Any]:
    """Best-effort static GPU info as resource attributes.

    Apple Silicon: report Apple integrated GPU using the chip name.
    NVIDIA: try pynvml (nvidia-ml-py); skip silently if absent or no GPU.
    """
    info: Dict[str, Any] = {}
    if sys.platform == 'darwin':
        chip = _macos_cpu_brand()
        if 'Apple' in chip:
            info['gpu.vendor'] = 'Apple'
            info['gpu.model'] = f'{chip} GPU'
            info['gpu.count'] = 1
            return info
    try:
        import pynvml  # provided by nvidia-ml-py
        pynvml.nvmlInit()
        try:
            count = pynvml.nvmlDeviceGetCount()
            if count > 0:
                h = pynvml.nvmlDeviceGetHandleByIndex(0)
                info['gpu.vendor'] = 'NVIDIA'
                info['gpu.model'] = pynvml.nvmlDeviceGetName(h).decode() if isinstance(
                    pynvml.nvmlDeviceGetName(h), bytes,
                ) else str(pynvml.nvmlDeviceGetName(h))
                info['gpu.count'] = count
        finally:
            try: pynvml.nvmlShutdown()
            except Exception: pass
    except Exception:
        pass
    return info


def _build_resource_attrs(service_name: str, service_namespace: str, host_owner: str = '') -> Dict[str, Any]:
    """OTel semantic-convention resource attributes that identify this run.

    These are attached to every metric and log automatically — Grafana queries
    can filter by host_name / host_id / device_cpu_brand / host_owner / etc.
    without per-call label work.
    """
    sysname = sys.platform  # 'darwin', 'linux', 'win32', ...
    os_type = {'darwin': 'darwin', 'win32': 'windows'}.get(sysname,
                                                          'linux' if sysname.startswith('linux') else sysname)

    cpu_brand = ''
    if sys.platform == 'darwin':
        cpu_brand = _macos_cpu_brand()
    if not cpu_brand:
        cpu_brand = platform.processor() or platform.machine() or ''

    host_type = ''
    if sys.platform == 'darwin':
        host_type = _macos_hardware_model()

    # Friendly machine label — explicit > $USER > empty
    owner = (host_owner or '').strip() or os.environ.get('USER') or os.environ.get('USERNAME') or ''

    attrs: Dict[str, Any] = {
        'service.name':         service_name,
        'service.namespace':    service_namespace,
        'service.instance.id':  str(uuid.uuid4()),  # unique per process run
        'host.name':            socket.gethostname(),
        'host.id':              _stable_host_id(),
        'host.arch':            platform.machine() or '',
        'os.type':              os_type,
        'os.name':              platform.system() or '',
        'os.version':           platform.release() or '',
        'os.description':       platform.platform(),
        'process.pid':           os.getpid(),
        'process.runtime.name':    platform.python_implementation(),
        'process.runtime.version': platform.python_version(),
        'device.cpu.brand':     cpu_brand,
    }
    if host_type:
        attrs['host.type'] = host_type
    if owner:
        attrs['host.owner'] = owner

    attrs.update(_gpu_info())
    # Drop empty values — Grafana labels with "" are noise.
    return {k: v for k, v in attrs.items() if v not in (None, '')}


# ── Init / shutdown ───────────────────────────────────────────────────────────

def init_telemetry(config: Optional[Dict[str, Any]]):
    """Configure OTel exporters from a `telemetry` config block.

    Expected shape:
        {"enabled": bool,
         "otlp_endpoint": "https://otlp-gateway-prod-us-east-0.grafana.net/otlp",
         "auth_token": "Bearer glc_xxx...",
         "service_prefix": "solvewatch"}
    """
    global _enabled, _meter, _otel_logger, _meter_provider, _logger_provider, _service_name
    global _logging_bridge
    global HIST_VAD_LATENCY_MS, HIST_WHISPER_DECODE_MS, HIST_SPEAKER_ID_LATENCY_MS
    global HIST_SILENCE_WAIT_ACTUAL_MS
    global COUNT_UTTERANCES_DETECTED, COUNT_UTTERANCES_PASSED, COUNT_UTTERANCES_DISCARDED
    global GAUGE_LISTENER_ACTIVE, GAUGE_SPEAKER_ID_MODEL_STATUS, GAUGE_WHISPER_MODEL_LOADED
    global GAUGE_HOST_CPU_PERCENT, GAUGE_HOST_MEMORY_PERCENT, GAUGE_HOST_MEMORY_USED_BYTES
    global GAUGE_PROCESS_CPU_PERCENT, GAUGE_PROCESS_MEMORY_RSS_BYTES
    global GAUGE_GPU_UTILIZATION_PERCENT, GAUGE_GPU_MEMORY_USED_BYTES

    with _init_lock:
        # Re-entrant: callers may flip the toggle from the settings page.
        # Tear down the existing exporters first so we don't leak providers.
        if _enabled:
            try:
                if _meter_provider is not None:
                    _meter_provider.shutdown()
            except Exception:
                pass
            try:
                if _logger_provider is not None:
                    _logger_provider.shutdown()
            except Exception:
                pass
            if _logging_bridge is not None:
                logging.getLogger().removeHandler(_logging_bridge)
            _enabled = False

        cfg = (config or {}).get("telemetry") if config and "telemetry" in (config or {}) else (config or {})
        # Accept either a top-level telemetry dict or the full config dict.
        if not isinstance(cfg, dict):
            cfg = {}

        if not cfg.get("enabled"):
            _install_noop_handles()
            logger.warning("Telemetry disabled — metrics + logs are no-ops")
            return

        endpoint     = (cfg.get("otlp_endpoint") or "").rstrip("/")
        instance_id  = str(cfg.get("instance_id") or "").strip()
        access_tok   = (cfg.get("access_token") or "").strip()
        legacy_token = (cfg.get("auth_token") or "").strip()
        # Build the Authorization header value:
        #   - Grafana Cloud:  Basic base64(instanceID:accessPolicyToken)
        #   - Legacy configs: use the assembled header from auth_token field
        #   - Fallback:       prepend Bearer if the token has no scheme
        if instance_id and access_tok:
            import base64 as _b64
            token = "Basic " + _b64.b64encode(f"{instance_id}:{access_tok}".encode("utf-8")).decode("ascii")
        elif legacy_token:
            token = legacy_token
        elif access_tok:
            token = access_tok if access_tok.startswith(("Bearer ", "Basic ")) else f"Bearer {access_tok}"
        else:
            token = ""
        prefix   = cfg.get("service_prefix") or "solvewatch"
        _service_name = f"{prefix}.transcriber"

        if not endpoint:
            _enabled = False
            _install_noop_handles()
            logger.warning("Telemetry enabled but no otlp_endpoint configured — falling back to no-op")
            return

        try:
            from opentelemetry import metrics
            from opentelemetry._logs import set_logger_provider, get_logger
            from opentelemetry.sdk.metrics import MeterProvider
            from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
            from opentelemetry.sdk.metrics.view import View, ExplicitBucketHistogramAggregation
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk._logs import LoggerProvider
            from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
            from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
            from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        except Exception as e:
            _enabled = False
            _install_noop_handles()
            logger.error("Telemetry: OTel imports failed (%s) — falling back to no-op", e)
            return

        try:
            headers = {"Authorization": token} if token else {}
            # host_owner can live at top-level config (preferred) or inside telemetry block.
            host_owner = ''
            if config and isinstance(config, dict):
                host_owner = (config.get('host_owner') or cfg.get('host_owner') or '').strip()
            resource_attrs = _build_resource_attrs(_service_name, prefix, host_owner)
            logger.info(
                "Telemetry resource attrs: host=%s host_id=%s os=%s cpu=%s gpu=%s",
                resource_attrs.get('host.name'),
                resource_attrs.get('host.id', '')[:8],
                resource_attrs.get('os.description'),
                resource_attrs.get('device.cpu.brand'),
                resource_attrs.get('gpu.model', '(none)'),
            )
            resource = Resource.create(resource_attrs)

            # Cache host-identity labels for instrument attributes — Grafana Cloud
            # doesn't promote resource attrs to metric labels automatically.
            global _host_labels
            _host_labels = {k: v for k, v in {
                'host_name':        resource_attrs.get('host.name', ''),
                'host_owner':       resource_attrs.get('host.owner', ''),
                'host_id':          resource_attrs.get('host.id', ''),
                'host_arch':        resource_attrs.get('host.arch', ''),
                'device_cpu_brand': resource_attrs.get('device.cpu.brand', ''),
                'os_type':          resource_attrs.get('os.type', ''),
            }.items() if v}

            # ── Metrics ──────────────────────────────────────────────────────
            metric_exporter = OTLPMetricExporter(
                endpoint=f"{endpoint}/v1/metrics",
                headers=headers,
                timeout=5,
            )
            reader = PeriodicExportingMetricReader(
                metric_exporter,
                export_interval_millis=10_000,
                export_timeout_millis=5_000,
            )
            # Custom histogram bucket boundaries. OTel defaults are too coarse
            # for sub-10-ms VAD calls and for the long tail of AI latency. The
            # lists below are logarithmic-ish across the metric's expected
            # range, giving usable P50/P95/P99 out of the box.
            _fine_submicro = [0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100, 200, 500]
            _ai_lat        = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000,
                              6000, 7500, 10000, 15000, 20000, 30000]
            _whisper_lat   = [25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000]
            _views = [
                View(instrument_name='vad_latency_ms',
                     aggregation=ExplicitBucketHistogramAggregation(boundaries=_fine_submicro)),
                View(instrument_name='whisper_decode_ms',
                     aggregation=ExplicitBucketHistogramAggregation(boundaries=_whisper_lat)),
                View(instrument_name='speaker_id_latency_ms',
                     aggregation=ExplicitBucketHistogramAggregation(boundaries=_whisper_lat)),
                View(instrument_name='silence_wait_actual_ms',
                     aggregation=ExplicitBucketHistogramAggregation(boundaries=_ai_lat)),
            ]
            _meter_provider = MeterProvider(resource=resource, metric_readers=[reader], views=_views)
            metrics.set_meter_provider(_meter_provider)
            _meter = metrics.get_meter(_service_name)

            # ── Logs ─────────────────────────────────────────────────────────
            log_exporter = OTLPLogExporter(
                endpoint=f"{endpoint}/v1/logs",
                headers=headers,
                timeout=5,
            )
            _logger_provider = LoggerProvider(resource=resource)
            _logger_provider.add_log_record_processor(
                BatchLogRecordProcessor(
                    log_exporter,
                    max_queue_size=10_000,
                    schedule_delay_millis=5_000,
                    max_export_batch_size=512,
                    export_timeout_millis=5_000,
                )
            )
            set_logger_provider(_logger_provider)
            _otel_logger = get_logger(_service_name)

            # Bridge Python stdlib logging (WARNING+) → OTel/Loki so that
            # logger.error() / logger.warning() calls appear in Grafana automatically.
            _logging_bridge = LoggingHandler(level=logging.WARNING, logger_provider=_logger_provider)
            # Exclude OTel's own internal loggers to prevent feedback loops.
            _logging_bridge.addFilter(lambda r: not r.name.startswith('opentelemetry'))
            logging.getLogger().addHandler(_logging_bridge)

            # ── Build metric handles ─────────────────────────────────────────
            # Don't pass `unit` — Grafana Cloud's OTLP→Mimir translator appends
            # the unit as a name suffix (`_milliseconds`), which collides with
            # our names that already end in `_ms`. We encode the unit in the
            # name itself.
            HIST_VAD_LATENCY_MS = _meter.create_histogram(
                "vad_latency_ms",
                description="VAD per-chunk inference latency",
            )
            HIST_WHISPER_DECODE_MS = _meter.create_histogram(
                "whisper_decode_ms",
                description="Whisper per-decode latency",
            )
            HIST_SPEAKER_ID_LATENCY_MS = _meter.create_histogram(
                "speaker_id_latency_ms",
                description="Speaker-ID identify() latency",
            )
            HIST_SILENCE_WAIT_ACTUAL_MS = _meter.create_histogram(
                "silence_wait_actual_ms",
                description="Actual silence wait before stt_final emit",
            )

            COUNT_UTTERANCES_DETECTED = _meter.create_counter(
                "utterances_detected_total",
                description="Total VAD speech-start transitions",
            )
            COUNT_UTTERANCES_PASSED = _meter.create_counter(
                "utterances_passed_total",
                description="Utterances forwarded to AI",
            )
            COUNT_UTTERANCES_DISCARDED = _meter.create_counter(
                "utterances_discarded_total",
                description="Utterances filtered out before AI (with reason label)",
            )
            # Seed counters with .add(0) so Prometheus' increase() has a
            # baseline sample — without this the first real event is invisible
            # to `sum(increase(X[$__range]))` and the counter reads N-1 for
            # the first N events. Also seed the known discard reasons so the
            # breakdown piechart doesn't look sparse at startup.
            try:
                COUNT_UTTERANCES_DETECTED.add(0)
                COUNT_UTTERANCES_PASSED.add(0)
                for _reason in ("greeting", "too_short", "hallucination",
                                "gibberish", "auto_answer_disabled"):
                    COUNT_UTTERANCES_DISCARDED.add(0, {"reason": _reason})
            except Exception:
                pass

            # OTel Python SDK <1.27 doesn't have UpDownCounter.set() — use observable
            # gauge proxies via a simple Counter-like wrapper that records the latest value.
            GAUGE_LISTENER_ACTIVE         = _SyncGauge(_meter, "listener_active",         "Always-on listener active (1/0)")
            GAUGE_SPEAKER_ID_MODEL_STATUS = _SyncGauge(_meter, "speaker_id_model_status", "Speaker ID model status (labeled)")
            GAUGE_WHISPER_MODEL_LOADED    = _SyncGauge(_meter, "whisper_model_loaded",    "Whisper model loaded (labeled)")

            # System resource gauges (populated by sampler thread).
            GAUGE_HOST_CPU_PERCENT        = _SyncGauge(_meter, "host_cpu_percent",         "Overall host CPU utilization (%)")
            GAUGE_HOST_MEMORY_PERCENT     = _SyncGauge(_meter, "host_memory_percent",      "Overall host memory utilization (%)")
            GAUGE_HOST_MEMORY_USED_BYTES  = _SyncGauge(_meter, "host_memory_used_bytes",   "Host memory used (bytes)")
            GAUGE_PROCESS_CPU_PERCENT     = _SyncGauge(_meter, "process_cpu_percent",      "This process CPU utilization (%, normalized to one core)")
            GAUGE_PROCESS_MEMORY_RSS_BYTES = _SyncGauge(_meter, "process_memory_rss_bytes", "This process resident set size (bytes)")
            GAUGE_GPU_UTILIZATION_PERCENT = _SyncGauge(_meter, "gpu_utilization_percent",  "GPU utilization (%, NVIDIA only)")
            GAUGE_GPU_MEMORY_USED_BYTES   = _SyncGauge(_meter, "gpu_memory_used_bytes",    "GPU memory used (bytes; NVIDIA + Apple MPS)")

            _enabled = True
            logger.info("Telemetry initialized (service=%s, endpoint=%s)", _service_name, endpoint)
        except Exception as e:
            _enabled = False
            _install_noop_handles()
            logger.error("Telemetry init failed (%s) — falling back to no-op", e)


def shutdown_telemetry():
    """Graceful flush at process shutdown."""
    global _enabled
    if not _enabled:
        return
    try:
        if _meter_provider is not None:
            _meter_provider.shutdown()
    except Exception as e:
        logger.warning("Telemetry: meter shutdown error %s", e)
    try:
        if _logger_provider is not None:
            _logger_provider.shutdown()
    except Exception as e:
        logger.warning("Telemetry: logger shutdown error %s", e)
    if _logging_bridge is not None:
        logging.getLogger().removeHandler(_logging_bridge)
    _enabled = False


def _install_noop_handles():
    """Install no-op metric handles so call sites don't have to branch on enabled."""
    global HIST_VAD_LATENCY_MS, HIST_WHISPER_DECODE_MS, HIST_SPEAKER_ID_LATENCY_MS
    global HIST_SILENCE_WAIT_ACTUAL_MS
    global COUNT_UTTERANCES_DETECTED, COUNT_UTTERANCES_PASSED, COUNT_UTTERANCES_DISCARDED
    global GAUGE_LISTENER_ACTIVE, GAUGE_SPEAKER_ID_MODEL_STATUS, GAUGE_WHISPER_MODEL_LOADED
    global GAUGE_HOST_CPU_PERCENT, GAUGE_HOST_MEMORY_PERCENT, GAUGE_HOST_MEMORY_USED_BYTES
    global GAUGE_PROCESS_CPU_PERCENT, GAUGE_PROCESS_MEMORY_RSS_BYTES
    global GAUGE_GPU_UTILIZATION_PERCENT, GAUGE_GPU_MEMORY_USED_BYTES

    HIST_VAD_LATENCY_MS         = _NOOP_HIST
    HIST_WHISPER_DECODE_MS      = _NOOP_HIST
    HIST_SPEAKER_ID_LATENCY_MS  = _NOOP_HIST
    HIST_SILENCE_WAIT_ACTUAL_MS = _NOOP_HIST
    COUNT_UTTERANCES_DETECTED   = _NOOP_COUNT
    COUNT_UTTERANCES_PASSED     = _NOOP_COUNT
    COUNT_UTTERANCES_DISCARDED  = _NOOP_COUNT
    GAUGE_LISTENER_ACTIVE         = _NOOP_GAUGE
    GAUGE_SPEAKER_ID_MODEL_STATUS = _NOOP_GAUGE
    GAUGE_WHISPER_MODEL_LOADED    = _NOOP_GAUGE
    GAUGE_HOST_CPU_PERCENT        = _NOOP_GAUGE
    GAUGE_HOST_MEMORY_PERCENT     = _NOOP_GAUGE
    GAUGE_HOST_MEMORY_USED_BYTES  = _NOOP_GAUGE
    GAUGE_PROCESS_CPU_PERCENT     = _NOOP_GAUGE
    GAUGE_PROCESS_MEMORY_RSS_BYTES = _NOOP_GAUGE
    GAUGE_GPU_UTILIZATION_PERCENT = _NOOP_GAUGE
    GAUGE_GPU_MEMORY_USED_BYTES   = _NOOP_GAUGE


# Install no-op handles immediately at import time so accidental early calls
# (before init_telemetry runs) don't AttributeError.
_install_noop_handles()


class _SyncGauge:
    """Thin wrapper around an observable gauge that remembers the last value
    per attribute set, so the periodic exporter can read it back.

    OTel Python's sync UpDownCounter has add() not set(); using observable_gauge
    keeps the ergonomics simple at call sites: gauge.set(1, {"label": "ok"}).
    """
    def __init__(self, meter, name: str, description: str):
        self._latest: Dict[Any, float] = {}
        self._lock = threading.Lock()
        meter.create_observable_gauge(
            name,
            description=description,
            callbacks=[self._observe],
        )

    def set(self, value: float, attributes: Optional[Dict[str, Any]] = None):
        key = _attr_key(attributes)
        with self._lock:
            self._latest[key] = float(value)

    def _observe(self, _options):
        from opentelemetry.metrics import Observation
        with self._lock:
            return [Observation(v, _attrs_from_key(k)) for k, v in self._latest.items()]


def _attr_key(attrs: Optional[Dict[str, Any]]):
    if not attrs:
        return ()
    return tuple(sorted((k, v) for k, v in attrs.items()))


def _attrs_from_key(key) -> Dict[str, Any]:
    return {k: v for k, v in key}


# ── Logging API (drop-in replacement for log_writer.log) ──────────────────────

def log(event: str, level: str = 'INFO', **fields):
    """Emit a structured log record.

    Same signature as the old log_writer.log(). When telemetry is disabled this
    is a no-op (the `logger` from the standard library still receives normal
    Python logs separately — this function only feeds OTel/Loki).
    """
    if not _enabled or _otel_logger is None:
        return
    try:
        from opentelemetry._logs import SeverityNumber

        sev_map = {
            'DEBUG':    SeverityNumber.DEBUG,
            'INFO':     SeverityNumber.INFO,
            'WARN':     SeverityNumber.WARN,
            'WARNING':  SeverityNumber.WARN,
            'ERROR':    SeverityNumber.ERROR,
            'CRITICAL': SeverityNumber.FATAL,
        }
        severity = sev_map.get(level.upper(), SeverityNumber.INFO)
        sanitized = _jsonable(fields)
        attributes = {'event': event, 'service': _service_name, **sanitized}

        # Body = JSON payload so Loki's `| json` parser + `{{.field}}` line_format
        # work on the raw log line. Attributes stay populated for index-backed
        # stream-selector filtering (e.g. `| event="stt_final_emitted"`).
        import json as _json
        body = _json.dumps({'event': event, **sanitized})

        # SDK >=1.27 removed LogRecord from opentelemetry.sdk._logs; Logger.emit()
        # now accepts keyword arguments directly.
        _otel_logger.emit(
            timestamp=int(time.time() * 1e9),
            observed_timestamp=int(time.time() * 1e9),
            severity_number=severity,
            severity_text=level.upper(),
            body=body,
            attributes=attributes,
        )
    except Exception as e:
        # Telemetry must never break the hot path. Log to stdlib logger only.
        logger.debug("telemetry.log failed: %s", e)


def is_enabled() -> bool:
    return _enabled


# ── System metrics sampler (CPU / memory / GPU) ──────────────────────────────

def start_system_metrics_sampler(interval_seconds: float = 10.0):
    """Start a daemon thread that samples host + process + GPU metrics.

    Cheap (~1 ms per tick), so 10 s is conservative. Safe to call when telemetry
    is disabled — the sampler still runs but every record() is a no-op.
    """
    global _sampler_thread, _sampler_running, _sampler_interval_s
    if _sampler_thread is not None and _sampler_thread.is_alive():
        return
    _sampler_interval_s = max(1.0, float(interval_seconds))
    _sampler_running = True
    _sampler_thread = threading.Thread(
        target=_sampler_loop, daemon=True, name='telemetry-system-sampler',
    )
    _sampler_thread.start()
    logger.info("Telemetry system-metrics sampler started (interval=%ss)", _sampler_interval_s)


def stop_system_metrics_sampler():
    global _sampler_running
    _sampler_running = False


def _sampler_loop():
    """Periodic: poll host + process + GPU; record gauges. Robust to missing libs."""
    try:
        import psutil
    except Exception as e:
        logger.warning("psutil missing — host/process metrics disabled: %s", e)
        return

    try:
        proc = psutil.Process()
        # First call primes psutil's CPU% delta tracking.
        psutil.cpu_percent(interval=None)
        proc.cpu_percent(interval=None)
    except Exception:
        proc = None

    # NVIDIA detection (best-effort, once)
    nvml = None
    try:
        import pynvml
        pynvml.nvmlInit()
        nvml = pynvml
    except Exception:
        nvml = None

    # Apple Silicon torch / MPS detection
    torch_mod = None
    try:
        import torch  # noqa: F401
        torch_mod = sys.modules.get('torch')
    except Exception:
        torch_mod = None

    while _sampler_running:
        try:
            # Host
            try:
                cpu_pct = psutil.cpu_percent(interval=None)
                vm = psutil.virtual_memory()
                GAUGE_HOST_CPU_PERCENT.set(cpu_pct, _host_labels if _host_labels else None)
                GAUGE_HOST_MEMORY_PERCENT.set(vm.percent, _host_labels if _host_labels else None)
                GAUGE_HOST_MEMORY_USED_BYTES.set(vm.used, _host_labels if _host_labels else None)
            except Exception:
                pass

            # This process — include host_name so dashboard {host_name=~"$host"} matches
            if proc is not None:
                try:
                    svc_label = {**_host_labels, "service_name": _service_name}
                    GAUGE_PROCESS_CPU_PERCENT.set(proc.cpu_percent(interval=None), svc_label)
                    GAUGE_PROCESS_MEMORY_RSS_BYTES.set(proc.memory_info().rss, svc_label)
                except Exception:
                    pass

            # NVIDIA GPU
            if nvml is not None:
                try:
                    count = nvml.nvmlDeviceGetCount()
                    for i in range(count):
                        h = nvml.nvmlDeviceGetHandleByIndex(i)
                        util = nvml.nvmlDeviceGetUtilizationRates(h)
                        mem  = nvml.nvmlDeviceGetMemoryInfo(h)
                        labels = {"device_index": i}
                        GAUGE_GPU_UTILIZATION_PERCENT.set(float(util.gpu), labels)
                        GAUGE_GPU_MEMORY_USED_BYTES.set(float(mem.used), labels)
                except Exception:
                    pass

            # Apple Silicon — utilization is unavailable without sudo. Report
            # MPS-allocated memory so dashboards still have *something* GPU-ish.
            if sys.platform == 'darwin' and torch_mod is not None:
                try:
                    if getattr(torch_mod.backends, 'mps', None) and torch_mod.backends.mps.is_available():
                        used = torch_mod.mps.current_allocated_memory()
                        GAUGE_GPU_MEMORY_USED_BYTES.set(float(used), {"device_index": 0})
                except Exception:
                    pass
        except Exception as e:
            logger.debug("system-sampler tick error: %s", e)

        # Sleep in small increments so stop_system_metrics_sampler() reacts quickly.
        slept = 0.0
        while _sampler_running and slept < _sampler_interval_s:
            time.sleep(0.5)
            slept += 0.5

    if nvml is not None:
        try: nvml.nvmlShutdown()
        except Exception: pass


def _jsonable(d: Dict[str, Any]) -> Dict[str, Any]:
    """OTel attributes must be primitives (str/int/float/bool) or sequences
    of those. Stringify anything else so we never drop a record over a type
    mismatch.
    """
    out: Dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = v
        else:
            try:
                out[k] = str(v)
            except Exception:
                out[k] = repr(v)
    return out
