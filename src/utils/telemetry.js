/**
 * OpenTelemetry → Grafana Cloud (OTLP HTTP) — fully async, never blocks the hot path.
 *
 * Two surfaces:
 *   - meter (metrics): histograms / counters / observable gauges, batched every 10 s
 *   - logger (logs):   structured records via BatchLogRecordProcessor, bounded queue
 *
 * Two activation modes:
 *   - telemetry.enabled = false → all calls are no-ops; one console warning at boot
 *   - Grafana unreachable        → OTel retry/backoff; bounded queue drops oldest
 *
 * Public API:
 *   initTelemetry(config)                          — call from server.js startup
 *   shutdownTelemetry()                            — call from gracefulShutdown
 *   logEvent(event, level='INFO', fields={})       — same shape as the old file-logger
 *   recordHistogram(name, value, attrs)            — convenience, validated names below
 *   addCounter(name, value=1, attrs)
 *   setGauge(name, value, attrs)
 *
 * Service name: `${service_prefix}.server` (default: solvewatch.server)
 *
 */
import os from 'os';
import { execSync } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { metrics, ValueType } from '@opentelemetry/api';
import { logs as logsApi, SeverityNumber } from '@opentelemetry/api-logs';
import { Resource } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader, View, ExplicitBucketHistogramAggregation } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter }    from '@opentelemetry/exporter-logs-otlp-http';

let _enabled = false;
let _meterProvider = null;
let _loggerProvider = null;
let _meter = null;
let _otelLogger = null;
let _serviceName = 'solvewatch.server';

const _histograms = new Map();
const _counters   = new Map();

// Observable gauges keep their latest value per attribute set; the periodic
// reader pulls via callback. Same trick as the Python module.
class GaugeStore {
  constructor() { this._latest = new Map(); }
  set(value, attrs = {}) {
    const key = JSON.stringify(attrs);
    this._latest.set(key, { value: Number(value), attrs });
  }
  observe(observable) {
    for (const { value, attrs } of this._latest.values()) {
      observable.observe(value, attrs);
    }
  }
}
const _gaugeStores = new Map();

const HISTOGRAM_NAMES = [
  'ai_ttft_ms',
  'ai_total_ms',
  'ocr_duration_ms',
  'screenshot_capture_ms',
  'screenshot_pipeline_total_ms',
  'end_to_end_question_ms',
  'stt_socket_rtt_ms',
  'question_extraction_ms',
  'http_request_duration_ms',
];

const COUNTER_NAMES = [
  'ai_provider_success_total',
  'ai_provider_failure_total',
  'screenshot_captured_total',
  'ocr_failed_total',
  // AI observability — token spend + cost in USD
  'ai_input_tokens_total',
  'ai_output_tokens_total',
  'ai_cost_usd_total',
  // Anthropic prompt-cache visibility (read = cache hit, creation = first-time write)
  'ai_cache_read_tokens_total',
  'ai_cache_creation_tokens_total',
];

const GAUGE_NAMES = [
  'host_cpu_percent',
  'host_memory_percent',
  'host_memory_used_bytes',
  'process_cpu_percent',
  'process_memory_rss_bytes',
  'gpu_utilization_percent',
  'gpu_memory_used_bytes',
];

let _samplerHandle = null;

/** Cached host-identity labels — attached to every system metric so they
 *  appear as direct metric labels (Grafana Cloud's OTLP gateway doesn't
 *  promote arbitrary resource attrs to metric labels). */
let _hostLabels = {};

// ── Resource attribute discovery (multi-machine identity) ───────────────────

function _macSysctl(key) {
  try {
    return execSync(`sysctl -n ${key}`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
      .toString().trim();
  } catch { return ''; }
}

function _stableHostId() {
  // Same logic as the Python side — picks the same value for both services
  // running on one machine, even across reboots.
  try {
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice',
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString();
      const m = out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else if (process.platform === 'linux') {
      try { return require('fs').readFileSync('/etc/machine-id', 'utf8').trim(); } catch {}
      try { return require('fs').readFileSync('/var/lib/dbus/machine-id', 'utf8').trim(); } catch {}
    }
  } catch {}
  // Fallback — hash of MAC addresses (stable per NIC).
  const ifs = os.networkInterfaces();
  const macs = [];
  for (const list of Object.values(ifs)) {
    for (const it of (list || [])) {
      if (it.mac && it.mac !== '00:00:00:00:00:00') macs.push(it.mac);
    }
  }
  return createHash('sha256').update(macs.sort().join(',') || os.hostname()).digest('hex').slice(0, 32);
}

function _gpuStaticInfo() {
  // Only the static parts go on the resource. Live util goes through gauges.
  if (process.platform === 'darwin') {
    const chip = _macSysctl('machdep.cpu.brand_string');
    if (chip.includes('Apple')) {
      return { 'gpu.vendor': 'Apple', 'gpu.model': `${chip} GPU`, 'gpu.count': 1 };
    }
  }
  // Best-effort cross-platform: rely on systeminformation later when we sample.
  return {};
}

function _buildResourceAttrs(serviceName, serviceNamespace, hostOwner = '') {
  const sysname = process.platform; // 'darwin', 'linux', 'win32'
  const osType = sysname === 'win32' ? 'windows' : sysname;

  let cpuBrand = '';
  if (sysname === 'darwin') cpuBrand = _macSysctl('machdep.cpu.brand_string');
  if (!cpuBrand) cpuBrand = (os.cpus()[0] && os.cpus()[0].model) || '';

  let hostType = '';
  if (sysname === 'darwin') hostType = _macSysctl('hw.model');

  // Friendly machine label — explicit > $USER > empty
  const owner = (hostOwner || '').trim() || (process.env.USER || process.env.USERNAME || '').trim() || '';

  const attrs = {
    'service.name':         serviceName,
    'service.namespace':    serviceNamespace,
    'service.instance.id':  randomUUID(),     // unique per process run
    'host.name':            os.hostname(),
    'host.id':              _stableHostId(),
    'host.arch':            os.arch(),
    'os.type':              osType,
    'os.name':              os.type(),
    'os.version':           os.release(),
    'os.description':       `${os.type()} ${os.release()}`,
    'process.pid':          process.pid,
    'process.runtime.name':    'nodejs',
    'process.runtime.version': process.versions.node,
    'device.cpu.brand':     cpuBrand,
    ...(hostType ? { 'host.type': hostType } : {}),
    ...(owner    ? { 'host.owner': owner } : {}),
    ..._gpuStaticInfo(),
  };
  // Drop empty values.
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

export async function initTelemetry(rawConfig) {
  // Re-entrant: callers may flip the toggle from the settings page. Tear down
  // the existing exporters first so we don't leak providers.
  if (_enabled) {
    await shutdownTelemetry();
  }

  const cfg = (rawConfig && rawConfig.telemetry) || rawConfig || {};
  if (!cfg.enabled) {
    console.warn('[telemetry] disabled — metrics + logs are no-ops');
    return;
  }

  const endpoint    = (cfg.otlp_endpoint || '').replace(/\/+$/, '');
  const instanceId  = (cfg.instance_id  || '').toString().trim();
  const accessTok   = (cfg.access_token || '').trim();
  // Backwards compat: older configs stored the assembled header in `auth_token`.
  const legacyToken = (cfg.auth_token   || '').trim();
  let token = '';
  if (instanceId && accessTok) {
    token = 'Basic ' + Buffer.from(`${instanceId}:${accessTok}`, 'utf8').toString('base64');
  } else if (legacyToken) {
    token = legacyToken;
  } else if (accessTok) {
    token = accessTok.startsWith('Bearer ') || accessTok.startsWith('Basic ')
      ? accessTok
      : `Bearer ${accessTok}`;
  }
  const prefix   = cfg.service_prefix || 'solvewatch';
  _serviceName   = `${prefix}.server`;

  if (!endpoint) {
    console.warn('[telemetry] enabled but no otlp_endpoint configured — falling back to no-op');
    return;
  }

  try {
    const headers = token ? { Authorization: token } : {};
    // host_owner can live at top-level config (preferred) or inside telemetry block.
    const hostOwner = (rawConfig && rawConfig.host_owner) || cfg.host_owner || '';
    const resourceAttrs = _buildResourceAttrs(_serviceName, prefix, hostOwner);
    console.log(
      `[telemetry] resource: host=${resourceAttrs['host.name']} ` +
      `host_id=${(resourceAttrs['host.id'] || '').slice(0, 8)} ` +
      `os=${resourceAttrs['os.description']} ` +
      `cpu=${resourceAttrs['device.cpu.brand']} ` +
      `gpu=${resourceAttrs['gpu.model'] || '(none)'}`,
    );
    const resource = new Resource(resourceAttrs);

    // Cache host-identity labels for the system-metrics sampler. Grafana Cloud
    // doesn't always promote resource attrs to direct metric labels, so we
    // attach them as instrument attributes instead.
    _hostLabels = {
      host_name:        resourceAttrs['host.name']        || '',
      host_owner:       resourceAttrs['host.owner']       || '',
      host_id:          resourceAttrs['host.id']          || '',
      host_arch:        resourceAttrs['host.arch']        || '',
      device_cpu_brand: resourceAttrs['device.cpu.brand'] || '',
      os_type:          resourceAttrs['os.type']          || '',
    };
    // Drop empty values
    _hostLabels = Object.fromEntries(Object.entries(_hostLabels).filter(([, v]) => v !== ''));

    // ── Metrics ────────────────────────────────────────────────────────────
    const metricExporter = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
      headers,
      timeoutMillis: 5_000,
    });
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10_000,
      exportTimeoutMillis:  5_000,
    });
    // Custom histogram boundaries (ms). OTel's default boundaries are
    // {0,5,10,25,50,75,100,250,500,750,1000,2500,5000,7500,10000,+Inf} which
    // is too coarse at the short end (VAD is typically 1–5 ms so everything
    // falls into the first bucket) and too coarse at the long end for AI
    // calls (2,500 → 5,000 → 7,500 → 10,000 loses resolution between 4 s
    // and 9 s). These custom lists are logarithmic-ish across each metric's
    // expected range, giving usable P50/P95/P99 out of the box.
    const FINE_SUBMS_BOUNDARIES = [
      0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100, 200, 500,
    ];
    const AI_LATENCY_BOUNDARIES = [
      100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000,
      6000, 7500, 10000, 15000, 20000, 30000,
    ];
    const _metricViews = [
      new View({
        instrumentName: 'vad_latency_ms',
        aggregation:    new ExplicitBucketHistogramAggregation(FINE_SUBMS_BOUNDARIES),
      }),
      new View({
        instrumentName: 'ai_total_ms',
        aggregation:    new ExplicitBucketHistogramAggregation(AI_LATENCY_BOUNDARIES),
      }),
      new View({
        instrumentName: 'ai_ttft_ms',
        aggregation:    new ExplicitBucketHistogramAggregation(AI_LATENCY_BOUNDARIES),
      }),
      new View({
        instrumentName: 'end_to_end_question_ms',
        aggregation:    new ExplicitBucketHistogramAggregation(AI_LATENCY_BOUNDARIES),
      }),
      new View({
        instrumentName: 'screenshot_pipeline_total_ms',
        aggregation:    new ExplicitBucketHistogramAggregation(AI_LATENCY_BOUNDARIES),
      }),
    ];
    _meterProvider = new MeterProvider({ resource, readers: [reader], views: _metricViews });
    metrics.setGlobalMeterProvider(_meterProvider);
    _meter = metrics.getMeter(_serviceName);

    for (const name of HISTOGRAM_NAMES) {
      // Don't pass `unit` — Grafana Cloud's OTLP→Mimir translator appends the
      // unit as a name suffix (`_milliseconds`), which collides with our names
      // that already end in `_ms`. We encode the unit in the name itself.
      _histograms.set(name, _meter.createHistogram(name, { valueType: ValueType.DOUBLE }));
    }
    for (const name of COUNTER_NAMES) {
      const c = _meter.createCounter(name);
      _counters.set(name, c);
    }
    // Seed unlabeled counters with .add(0) so Prometheus' increase() has a
    // baseline sample. Without this, `sum(increase(X[$__range]))` on a newly
    // created series is "no data" after the first real event and shows the
    // count minus 1 after the second — a well-known first-sample gotcha.
    // Labeled counters (provider/model/flow combos) can't all be pre-seeded
    // without knowing runtime values — dashboard panels over those use
    // max_over_time - min_over_time instead.
    for (const name of ['screenshot_captured_total', 'ocr_failed_total']) {
      _counters.get(name)?.add(0);
    }
    for (const name of GAUGE_NAMES) {
      const store = new GaugeStore();
      _gaugeStores.set(name, store);
      const gauge = _meter.createObservableGauge(name);
      gauge.addCallback((observable) => store.observe(observable));
    }

    // ── Logs ──────────────────────────────────────────────────────────────
    const logExporter = new OTLPLogExporter({
      url: `${endpoint}/v1/logs`,
      headers,
      timeoutMillis: 5_000,
    });
    _loggerProvider = new LoggerProvider({ resource });
    _loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter, {
      maxQueueSize:        10_000,
      maxExportBatchSize:  512,
      scheduledDelayMillis: 5_000,
      exportTimeoutMillis:  5_000,
    }));
    logsApi.setGlobalLoggerProvider(_loggerProvider);
    _otelLogger = logsApi.getLogger(_serviceName);

    _enabled = true;
    console.log(`[telemetry] initialized (service=${_serviceName}, endpoint=${endpoint})`);
  } catch (err) {
    console.error('[telemetry] init failed — falling back to no-op:', err.message);
  }
}

export async function shutdownTelemetry() {
  if (!_enabled) return;
  stopSystemMetricsSampler();
  try { await _meterProvider?.shutdown(); }  catch (e) { console.warn('[telemetry] meter shutdown error', e.message); }
  try { await _loggerProvider?.shutdown(); } catch (e) { console.warn('[telemetry] logger shutdown error', e.message); }
  _enabled = false;
}

// ── System metrics sampler (CPU / memory / GPU) ─────────────────────────────

let _siCache = null;            // cached `systeminformation` module reference
let _lastCpuSample = null;      // for process_cpu_percent calculation
let _lastCpuSampleAt = 0;

export async function startSystemMetricsSampler(intervalSeconds = 10) {
  if (_samplerHandle) return;
  // Lazy-load systeminformation so an install issue can't crash the server boot.
  try {
    _siCache = (await import('systeminformation')).default;
  } catch (e) {
    console.warn('[telemetry] systeminformation unavailable — host/GPU metrics disabled:', e.message);
  }
  _lastCpuSample = process.cpuUsage();
  _lastCpuSampleAt = Date.now();
  _samplerHandle = setInterval(() => _sampleOnce().catch(() => {}),
                               Math.max(1000, Math.floor(intervalSeconds * 1000)));
  // Don't keep the event loop alive just for telemetry sampling.
  if (_samplerHandle.unref) _samplerHandle.unref();
  console.log(`[telemetry] system-metrics sampler started (interval=${intervalSeconds}s)`);
}

export function stopSystemMetricsSampler() {
  if (_samplerHandle) {
    clearInterval(_samplerHandle);
    _samplerHandle = null;
  }
}

async function _sampleOnce() {
  // ── This process ────────────────────────────────────────────────────────
  try {
    const now = Date.now();
    const cpu = process.cpuUsage();   // microseconds, monotonic
    if (_lastCpuSample) {
      const userDelta = cpu.user   - _lastCpuSample.user;
      const sysDelta  = cpu.system - _lastCpuSample.system;
      const wallMs    = now - _lastCpuSampleAt;
      // Normalize to one core: 100% means one full core saturated.
      const pct = wallMs > 0 ? ((userDelta + sysDelta) / 1000) / wallMs * 100 : 0;
      setGauge('process_cpu_percent', pct, { ..._hostLabels, service_name: _serviceName });
    }
    _lastCpuSample = cpu;
    _lastCpuSampleAt = now;
    setGauge('process_memory_rss_bytes', process.memoryUsage().rss, { ..._hostLabels, service_name: _serviceName });
  } catch {}

  if (!_siCache) return;

  // ── Host CPU / memory ───────────────────────────────────────────────────
  try {
    const [load, mem] = await Promise.all([_siCache.currentLoad(), _siCache.mem()]);
    setGauge('host_cpu_percent',        load.currentLoad,                                                    _hostLabels);
    setGauge('host_memory_used_bytes',  mem.active,                                                          _hostLabels);
    setGauge('host_memory_percent',     mem.total > 0 ? (mem.active / mem.total) * 100 : 0,                  _hostLabels);
  } catch {}

  // ── GPU ────────────────────────────────────────────────────────────────
  try {
    const gpu = await _siCache.graphics();
    const controllers = (gpu && gpu.controllers) || [];
    controllers.forEach((c, i) => {
      const labels = { ..._hostLabels, device_index: i, vendor: c.vendor || '', model: c.model || '' };
      // utilizationGpu / memoryUsed populated for NVIDIA via nvidia-smi; on
      // Apple Silicon they're typically null — skip rather than emit zeros.
      if (typeof c.utilizationGpu === 'number') {
        setGauge('gpu_utilization_percent', c.utilizationGpu, labels);
      }
      if (typeof c.memoryUsed === 'number') {
        // systeminformation returns memoryUsed in MB; convert to bytes for parity with Python.
        setGauge('gpu_memory_used_bytes', c.memoryUsed * 1024 * 1024, labels);
      }
    });
  } catch {}
}

export function isEnabled() { return _enabled; }

/** Host-identity labels to attach to any histogram/counter that needs $host filtering. */
export function getHostLabels() { return { ..._hostLabels }; }

/**
 * Validate that an OTLP endpoint accepts our auth token by POSTing an empty
 * metrics payload and reading the response. Returns:
 *   { ok: true,  status: 2xx }
 *   { ok: false, status, reason: 'bad_token'|'not_found'|'unreachable'|'http_<code>' }
 *
 * Used by the settings-page "Save & Reload" flow before persisting
 * telemetry.enabled = true. Cheap (single HTTP round trip, ~5s timeout).
 */
export async function validateOtlpEndpoint(endpoint, token, timeoutMs = 5000) {
  const url = `${(endpoint || '').replace(/\/+$/, '')}/v1/metrics`;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: token } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ resourceMetrics: [] }),  // valid, empty OTLP payload
      signal:  ctrl.signal,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'bad_token' };
    if (res.status === 404) return { ok: false, status: res.status, reason: 'not_found' };
    return { ok: false, status: res.status, reason: `http_${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, reason: 'unreachable', error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Metric helpers (no-op when disabled) ────────────────────────────────────

export function recordHistogram(name, value, attrs = {}) {
  if (!_enabled) return;
  const h = _histograms.get(name);
  if (!h) return;
  try { h.record(Number(value), attrs); } catch (_) {}
}

export function addCounter(name, value = 1, attrs = {}) {
  if (!_enabled) return;
  const c = _counters.get(name);
  if (!c) return;
  try { c.add(value, attrs); } catch (_) {}
}

export function setGauge(name, value, attrs = {}) {
  if (!_enabled) return;
  const g = _gaugeStores.get(name);
  if (!g) return;
  g.set(value, attrs);
}

// ── Logging helper ──────────────────────────────────────────────────────────
// Drop-in replacement for the old file-logger.logEvent signature.

const SEV_MAP = {
  DEBUG:    SeverityNumber.DEBUG,
  INFO:     SeverityNumber.INFO,
  WARN:     SeverityNumber.WARN,
  WARNING:  SeverityNumber.WARN,
  ERROR:    SeverityNumber.ERROR,
  CRITICAL: SeverityNumber.FATAL,
};

export function logEvent(event, level = 'INFO', fields = {}) {
  if (!_enabled || !_otelLogger) return;
  try {
    _otelLogger.emit({
      severityNumber: SEV_MAP[level.toUpperCase()] ?? SeverityNumber.INFO,
      severityText:   level.toUpperCase(),
      body: event,
      attributes: { event, service: _serviceName, ..._sanitize(fields) },
    });
  } catch (_) {
    // Telemetry must never break the hot path.
  }
}

function _sanitize(d) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (v === null || v === undefined) { out[k] = String(v); continue; }
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') { out[k] = v; continue; }
    try { out[k] = JSON.stringify(v); } catch { out[k] = String(v); }
  }
  return out;
}
