/**
 * Structured event logger — OTel backed (delegates to telemetry.logEvent).
 *
 * The on-disk NDJSON writer was removed in the Latency & Observability Overhaul.
 * Grafana Cloud (via OTel logs) is now the single destination. Same
 * `logEvent(event, level, fields)` signature as before so existing call sites
 * keep working without edits.
 *
 * When telemetry is disabled, logEvent is a no-op (a one-time warning is
 * emitted from telemetry.initTelemetry on startup).
 */
import { logEvent as otelLogEvent } from './telemetry.js';

export function logEvent(event, level = 'INFO', fields = {}) {
  otelLogEvent(event, level, fields);
}
