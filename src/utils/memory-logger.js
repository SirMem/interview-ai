/**
 * Conversation-memory event logger — OTel backed.
 *
 * Same `logMemory(event, fields)` signature as before; the on-disk NDJSON
 * sink was removed in the Latency & Observability Overhaul. Records flow
 * through OTel logs to Grafana Cloud (Loki) with `kind: 'memory'` so they
 * can be filtered separately from server events.
 */
import { logEvent } from './telemetry.js';

export function logMemory(event, fields = {}) {
  logEvent(event, 'INFO', { kind: 'memory', ...fields });
}
