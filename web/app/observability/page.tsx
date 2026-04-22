import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Observability — SolveWatch AI Grafana & OpenTelemetry Setup",
  description:
    "How SolveWatch ships OpenTelemetry metrics and structured logs to Grafana Cloud from both the Node.js backend and Python transcriber — without touching the hot path.",
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: "2.5rem" }}>
    <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#fff", marginBottom: "1rem", letterSpacing: "-0.01em" }}>
      {title}
    </h2>
    {children}
  </section>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: "#94a3b8", lineHeight: 1.8, marginBottom: "1rem", fontSize: "0.95rem" }}>{children}</p>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 6, padding: "0.15rem 0.45rem", fontSize: "0.85rem", color: "#c4b5fd", fontFamily: "monospace" }}>
    {children}
  </code>
);

const Stat = ({ value, label }: { value: string; label: string }) => (
  <div style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "1.5rem", textAlign: "center" }}>
    <div style={{ fontSize: "2rem", fontWeight: 800, color: "#a855f7", marginBottom: "0.4rem" }}>{value}</div>
    <div style={{ fontSize: "0.8rem", color: "#64748b" }}>{label}</div>
  </div>
);

const MetricRow = ({ name, type, description }: { name: string; type: string; description: string }) => (
  <tr style={{ borderBottom: "1px solid rgba(139,92,246,0.07)" }}>
    <td style={{ padding: "0.65rem 1rem", color: "#c4b5fd", fontSize: "0.82rem", fontFamily: "monospace" }}>{name}</td>
    <td style={{ padding: "0.65rem 1rem", fontSize: "0.78rem" }}>
      <span style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 4, padding: "0.1rem 0.45rem", color: "#a855f7", fontWeight: 600 }}>
        {type}
      </span>
    </td>
    <td style={{ padding: "0.65rem 1rem", color: "#94a3b8", fontSize: "0.82rem" }}>{description}</td>
  </tr>
);

export default function ObservabilityPage() {
  return (
    <main style={{ background: "#0a0a0f", minHeight: "100vh", padding: "0 1.5rem 6rem" }}>
      <div style={{ maxWidth: "52rem", margin: "0 auto" }}>

        <div style={{ padding: "2rem 0" }}>
          <Link href="/" style={{ color: "#a855f7", fontSize: "0.85rem", textDecoration: "none", fontWeight: 600 }}>
            ← Back to SolveWatch
          </Link>
        </div>

        <div style={{ marginBottom: "3.5rem", paddingBottom: "2.5rem", borderBottom: "1px solid rgba(139,92,246,0.12)" }}>
          <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
            Deep dive · Observability
          </p>
          <h1 style={{ fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "1.25rem" }}>
            Grafana Cloud + OpenTelemetry
          </h1>
          <p style={{ fontSize: "1.05rem", color: "#64748b", lineHeight: 1.75 }}>
            SolveWatch instruments every layer of the pipeline — from VAD and Whisper decode inside the Python transcriber to AI provider latency and token cost in the Node backend — and ships it all to Grafana Cloud over OTLP, without ever touching the hot answer path.
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "3rem" }}>
          <Stat value="2" label="instrumented services" />
          <Stat value="10 s" label="metric batch interval" />
          <Stat value="10k" label="log queue depth" />
          <Stat value="0 ms" label="hot path overhead" />
        </div>

        <Section title="Architecture: two services, one Grafana destination">
          <P>
            Both the Node.js backend (<Code>src/utils/telemetry.js</Code>) and the Python transcriber (<Code>transcriber/telemetry.py</Code>) ship an identical OTel stack: a <strong style={{ color: "#e2e8f0" }}>metrics pipeline</strong> backed by <Code>MeterProvider</Code> with a <Code>PeriodicExportingMetricReader</Code> (10 s batch) and a <strong style={{ color: "#e2e8f0" }}>logs pipeline</strong> backed by <Code>LoggerProvider</Code> with <Code>BatchLogRecordProcessor</Code> (5 s flush, 10 k bounded queue). Both export over OTLP HTTP to Grafana Cloud.
          </P>
          <P>
            The previous on-disk NDJSON writers (<Code>logs/app.jsonl</Code>, <Code>logs/memory.jsonl</Code>) have been removed. Grafana Cloud is now the single log destination. If telemetry is disabled or the endpoint is unreachable, every call is a no-op — the answer pipeline is never blocked.
          </P>

          {/* Pipeline diagram */}
          <div style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 14, padding: "1.75rem", marginBottom: "1.5rem", fontFamily: "monospace", fontSize: "0.78rem", color: "#94a3b8", lineHeight: 2.1, overflowX: "auto" }}>
            <div style={{ color: "#a855f7" }}>Python transcriber (telemetry.py)</div>
            <div>  OTel MeterProvider + LoggerProvider</div>
            <div>  ↓ OTLP HTTP /v1/metrics, /v1/logs (10 s batch)</div>
            <div style={{ color: "#a855f7" }}>Node.js backend (telemetry.js)</div>
            <div>  OTel MeterProvider + LoggerProvider</div>
            <div>  ↓ OTLP HTTP /v1/metrics, /v1/logs (10 s batch)</div>
            <div style={{ color: "#e2e8f0" }}>Grafana Cloud OTLP gateway</div>
            <div>  ↓ metrics → Grafana Mimir (PromQL)</div>
            <div>  ↓ logs   → Grafana Loki (LogQL)</div>
            <div style={{ color: "#4ade80" }}>Dashboard + alerts in docs/grafana-dashboard.json ✓</div>
          </div>
        </Section>

        <Section title="Node.js backend metrics">
          <P>
            The server instruments every step of both the screenshot and listen flows. Histograms capture latency distributions; counters track throughput and cost.
          </P>
          <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, overflow: "hidden" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(139,92,246,0.15)" }}>
                  {["Metric", "Type", "What it measures"].map((h) => (
                    <th key={h} style={{ padding: "0.875rem 1rem", textAlign: "left", fontSize: "0.78rem", fontWeight: 700, color: "#64748b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <MetricRow name="ai_ttft_ms"                    type="histogram" description="Time-to-first-token per provider call" />
                <MetricRow name="ai_total_ms"                   type="histogram" description="Full AI generation duration" />
                <MetricRow name="ocr_duration_ms"               type="histogram" description="Tesseract OCR latency per image" />
                <MetricRow name="screenshot_pipeline_total_ms"  type="histogram" description="End-to-end screenshot → answer ready" />
                <MetricRow name="end_to_end_question_ms"        type="histogram" description="stt_final received → answer complete" />
                <MetricRow name="http_request_duration_ms"      type="histogram" description="Express route latency" />
                <MetricRow name="ai_provider_success_total"     type="counter"   description="Successful AI calls (labeled by provider)" />
                <MetricRow name="ai_provider_failure_total"     type="counter"   description="Failed AI calls (labeled by provider + reason)" />
                <MetricRow name="ai_input_tokens_total"         type="counter"   description="Input tokens consumed" />
                <MetricRow name="ai_output_tokens_total"        type="counter"   description="Output tokens generated" />
                <MetricRow name="ai_cost_usd_total"             type="counter"   description="Estimated AI spend in USD" />
                <MetricRow name="ai_cache_read_tokens_total"    type="counter"   description="Anthropic prompt-cache hits (tokens read)" />
                <MetricRow name="ai_cache_creation_tokens_total" type="counter"  description="Anthropic prompt-cache writes (first-time)" />
                <MetricRow name="screenshot_captured_total"     type="counter"   description="Screenshots processed" />
                <MetricRow name="ocr_failed_total"              type="counter"   description="OCR failures" />
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Python transcriber metrics">
          <P>
            The transcriber instruments VAD, Whisper, and speaker identification — the three steps where latency variance most affects the time between when someone finishes speaking and when the AI starts answering.
          </P>
          <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, overflow: "hidden" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(139,92,246,0.15)" }}>
                  {["Metric", "Type", "What it measures"].map((h) => (
                    <th key={h} style={{ padding: "0.875rem 1rem", textAlign: "left", fontSize: "0.78rem", fontWeight: 700, color: "#64748b" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <MetricRow name="vad_latency_ms"            type="histogram" description="VAD inference time per audio chunk" />
                <MetricRow name="whisper_decode_ms"         type="histogram" description="Whisper per-decode duration (300 ms loop)" />
                <MetricRow name="speaker_id_latency_ms"     type="histogram" description="Speaker ID classify() call latency" />
                <MetricRow name="silence_wait_actual_ms"    type="histogram" description="Measured silence gap before stt_final emit" />
                <MetricRow name="utterances_detected_total" type="counter"   description="VAD speech-start transitions" />
                <MetricRow name="utterances_passed_total"   type="counter"   description="Utterances forwarded to AI" />
                <MetricRow name="utterances_discarded_total" type="counter"  description="Utterances filtered (labeled with reason)" />
                <MetricRow name="listener_active"           type="gauge"     description="Always-on listener running (1/0)" />
                <MetricRow name="whisper_model_loaded"      type="gauge"     description="Whisper model warm in memory (1/0)" />
                <MetricRow name="speaker_id_model_status"   type="gauge"     description="Speaker ID model ready (labeled)" />
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Host and process gauges (both services)">
          <P>
            Both services run a background sampler (10 s interval on a daemon thread / unref'd interval) that pushes system-resource gauges. On Apple Silicon the sampler reports MPS-allocated memory via PyTorch; on NVIDIA it uses <Code>pynvml</Code>. These gauges include <Code>host_name</Code>, <Code>host_owner</Code>, and <Code>device_cpu_brand</Code> as direct metric labels so Grafana dashboards can filter by machine without relying on resource attribute promotion.
          </P>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
            {[
              ["host_cpu_percent",         "Overall host CPU %"],
              ["host_memory_percent",      "Host RAM used %"],
              ["host_memory_used_bytes",   "Host RAM used (bytes)"],
              ["process_cpu_percent",      "This process CPU %"],
              ["process_memory_rss_bytes", "Process RSS memory"],
              ["gpu_utilization_percent",  "GPU utilization %"],
              ["gpu_memory_used_bytes",    "GPU memory used"],
            ].map(([name, label]) => (
              <div key={name} style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 10, padding: "0.875rem 1rem" }}>
                <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#c4b5fd", marginBottom: "0.3rem" }}>{name}</div>
                <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{label}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Multi-machine identity">
          <P>
            Every metric and log record carries OTel resource attributes that uniquely identify the machine. <Code>host.id</Code> uses <Code>IOPlatformUUID</Code> on macOS and <Code>/etc/machine-id</Code> on Linux — it stays stable across reboots. Both services derive the same <Code>host.id</Code> for a given machine, so logs from Node and metrics from Python can be correlated in Grafana without a join key.
          </P>
          <div style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "1.25rem 1.5rem", fontFamily: "monospace", fontSize: "0.78rem", color: "#94a3b8", lineHeight: 2 }}>
            <div><span style={{ color: "#a855f7" }}>service.name</span>        solvewatch.server / solvewatch.transcriber</div>
            <div><span style={{ color: "#a855f7" }}>host.name</span>           machine hostname</div>
            <div><span style={{ color: "#a855f7" }}>host.id</span>             IOPlatformUUID (macOS) / machine-id (Linux)</div>
            <div><span style={{ color: "#a855f7" }}>host.arch</span>           arm64 / x86_64</div>
            <div><span style={{ color: "#a855f7" }}>device.cpu.brand</span>    Apple M3 Pro / Intel Core i9-...</div>
            <div><span style={{ color: "#a855f7" }}>os.type</span>             darwin / linux / windows</div>
            <div><span style={{ color: "#a855f7" }}>host.owner</span>          optional — set via host_owner in config</div>
            <div><span style={{ color: "#a855f7" }}>gpu.vendor / gpu.model</span>  Apple / NVIDIA + model string</div>
          </div>
        </Section>

        <Section title="Logging: from NDJSON files to Loki">
          <P>
            Previously, <Code>file-logger.js</Code> and <Code>memory-logger.js</Code> wrote structured NDJSON to <Code>logs/app.jsonl</Code> and <Code>logs/memory.jsonl</Code> on disk. In this overhaul those writers have been replaced: both modules now delegate to <Code>telemetry.logEvent()</Code>, which emits an OTel log record to Grafana Loki via the same OTLP HTTP exporter. The call-site API is identical — no existing event emitters changed.
          </P>
          <P>
            Logs are queued in a bounded <Code>BatchLogRecordProcessor</Code> (max 10 k records, flush every 5 s). If Grafana is unreachable, the OTel SDK retries with exponential backoff and drops the oldest records when the queue fills — the answer path is never blocked. The same design applies on the Python side (<Code>log_writer.py</Code> → <Code>telemetry.log()</Code>).
          </P>
        </Section>

        <Section title="Configuration">
          <P>
            Telemetry is configured in <Code>config/api-keys.json</Code> under a <Code>telemetry</Code> key and can be toggled live from the settings page at <Code>http://localhost:4000/settings</Code> — no restart required. The settings page validates the OTLP endpoint before saving by POSTing an empty metrics payload and checking the response code.
          </P>
          <div style={{ background: "rgba(17,17,24,0.8)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 12, padding: "1.25rem 1.5rem", fontFamily: "monospace", fontSize: "0.8rem", color: "#94a3b8", lineHeight: 1.9, overflowX: "auto" }}>
            <div><span style={{ color: "#64748b" }}>{"//"} api-keys.json</span></div>
            <div>{`{`}</div>
            <div>{`  "telemetry": {`}</div>
            <div>{`    "enabled": true,`}</div>
            <div>{`    "otlp_endpoint": `}<span style={{ color: "#4ade80" }}>"https://otlp-gateway-prod-us-east-0.grafana.net/otlp"</span>{","}</div>
            <div>{`    "instance_id":   `}<span style={{ color: "#4ade80" }}>"123456"</span>{",  "}<span style={{ color: "#64748b" }}>{`// Grafana Cloud stack ID`}</span></div>
            <div>{`    "access_token":  `}<span style={{ color: "#4ade80" }}>"glc_eyJ..."</span>{",  "}<span style={{ color: "#64748b" }}>{`// Access Policy token`}</span></div>
            <div>{`    "service_prefix": `}<span style={{ color: "#4ade80" }}>"solvewatch"</span>{",  "}<span style={{ color: "#64748b" }}>{`// prefix for service.name`}</span></div>
            <div>{`    "host_owner":    `}<span style={{ color: "#4ade80" }}>"yourname"</span>{"   "}<span style={{ color: "#64748b" }}>{`// optional machine label`}</span></div>
            <div>{`  }`}</div>
            <div>{`}`}</div>
          </div>
        </Section>

        <div style={{ display: "flex", gap: "1.5rem", paddingTop: "2.5rem", borderTop: "1px solid rgba(139,92,246,0.12)", flexWrap: "wrap" }}>
          <Link href="/latency" style={{ color: "#a855f7", fontSize: "0.875rem", textDecoration: "none", fontWeight: 600 }}>
            ← Why it&apos;s fast
          </Link>
          <Link href="/how-it-works" style={{ color: "#64748b", fontSize: "0.875rem", textDecoration: "none" }}>
            The full pipeline →
          </Link>
        </div>
      </div>
    </main>
  );
}
