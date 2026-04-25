# Dashboard & Telemetry — Pending Changes

Captured from audit on 2026-04-23 (branch `fix/otel-logrecord-server-lifecycle-events`). Tackle in priority order.

## Priority fixes

1. **Flip `telemetry.enabled` default to `true`** in `config/api-keys.json.example` so new deployments actually export. Today it ships as `false` — if a user copies the example verbatim, **nothing** reaches Grafana and every dashboard panel is empty.

2. **Emit `ai_provider_success_total` / `ai_provider_failure_total` with `flow: 'screenshot'`** in the screenshot path (`src/services/image-processing.service.js` — wrap the `aiService.askGpt()` call). Today these counters are only emitted with `flow: 'transcription'`, so the screenshot provider-health panels (#736, #737) are empty regardless of traffic.

3. **Un-sample the VAD latency histogram** in `transcriber/always_on_listener.py:247-250`. The `.record()` call is gated behind `random.random() < 0.1`. SDK aggregation already makes histograms cheap — keep the 10% sampling on the `vad_chunk` log event, drop it on the metric. Panel #410 will stop looking sparse.

4. **Add `$flow` filter to aggregated cost panels** in `docs/grafana-dashboard.json`:
   - Panel 1  ($ spent)  — add `flow=~"$flow"` (already done)
   - Panel 6  (Cost per question) — currently divides cross-flow cost by STT-only utterances. Split by flow.
   - Panel 2  (Spend forecast 30d) — split by flow
   - Panel 41 ($ rate by provider) — add `flow=~"$flow"`
   - Panel 42 (Tokens in/out) — add `flow=~"$flow"`
   - Panel 44 (Output-token share) — add `flow=~"$flow"`
   - Panel 45 (Local vs paid) — already implicit via `provider="ollama"`, OK

5. **Convert `provider` dashboard variable from `custom` (hardcoded list) to `query`**:
   ```
   label_values(ai_ttft_ms_bucket, provider)
   ```
   This prevents label-value mismatches (e.g. `"grok"` vs `"groq"`) from making panels empty.

6. **Uncollapse rows 401 (STT pipeline latency) and 402 (Screenshot pipeline latency)** — these are the dashboard's reason for existing. Defaults to collapsed today; user sees stat cards and host CPU, not what they actually opened the dashboard for.

7. **Delete or consolidate redundant panels** — see audit; specifically:
   - Duplicate stat cards 201/202/203 (already shown in rows 417/420/731)
   - Aggregate-vs-split CPU/RSS (53/54 duplicate 531/532/541/542)
   - Row 301 (lifecycle-events grep) → already discoverable from main logs 821/822
   - Row 500 errors/warnings → use level filter on unified logs panel instead

Target: 71 panels → ~15.

## Longer-term ideas (not blocking)

- `speaker_id_enrollment_total` counter with `success=true/false`
- `reason` label on `ocr_failed_total`
- `model` label on `ai_cost_usd_total` (so cost-per-model is queryable)
- Drop `host_memory_used_bytes` gauge (redundant with `host_memory_percent`)
- Drop `GAUGE_WHISPER_MODEL_LOADED` / `GAUGE_SPEAKER_ID_MODEL_STATUS` — emit as log events at startup/change, free the gauge slot
