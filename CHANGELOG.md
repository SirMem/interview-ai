# Changelog

All notable changes to SolveWatch AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **FTS5 full-text search across Conversation Turns** (#4) — new `searchTurns(query, options)` method on `SessionService` executes FTS5 `MATCH` queries against the `conversation_turns_fts` virtual table. User input is automatically sanitised (special chars stripped, spaces converted to `AND`) to produce safe FTS5 queries. Results include `turn_id`, `session_id`, `turn_index`, `cleaned_question`, `answer`, `raw_transcript`, an FTS5 `snippet` with `<b>` highlights, and pagination metadata.
- **`GET /api/sessions/search` route** — bound to `search` controller handler before the `:id` param routes to prevent route collision. Accepts `?q=` for the search term and optional `limit`/`offset` for pagination.
- **7 new service tests** — covers search across `cleaned_question`, `answer`, `raw_transcript`, no-match case, empty query validation error, Chinese text search, and pagination. Total service tests: 37.
- **2 new route tests** — covers successful search response and 400 on missing `q` parameter.
- **Session Event traceability** (`src/services/session.service.js`) — new `appendEvent(sessionId, eventType, payload)` method records key lifecycle and processing-stage milestones to the `session_events` table (with UUID, ISO timestamp, and validated JSON payload). Lifecycle events are automatically recorded in `createSession()` (`session_started`), `ensureActiveSession()` auto-create path (`session_auto_created`), and `appendTurn()` (`conversation_turn_created`).
- **Live answer events wired into `handleSttFinal()`** — `dataHandler.js` now records `stt_final_received`, `ai_answer_started`, `ai_answer_completed`, and `ai_answer_failed` events during the always-on listen flow. All writes are best-effort (try/catch) and never block token streaming. `sessionService.ensureActiveSession()` is now called at the start of the handler and reused for both events and turn persistence.
- **10 new service tests** — covers `appendEvent` validation and field mapping, auto-recording on `createSession`/`ensureActiveSession`/`appendTurn`, and one full lifecycle path (create → appendTurn → chronological event chain). Total service tests: 30.
- **Manual session end** (`src/services/session.service.js`) — `endSession(sessionId)` marks an active session as `ended`, sets `ended_at`, clears `activeSessionId` if applicable, and records a `session_ended` event with `{ manual: true }`.
- **Stale session auto-archive** (`src/services/session.service.js`) — `archiveStaleActiveSessions()` queries all `active` sessions with `updated_at` older than 12 hours, sets them to `archived` with `ended_at`, records `session_auto_archived` events, and clears `activeSessionId` if the current session is archived. Runs automatically on service construction.
- **`POST /api/sessions/:id/end` REST endpoint** — returns the updated session on success, 404 if the session does not exist.
- **Socket.IO `end_session` / `session_ended` events** — `dataHandler.js` listens for `end_session` from any client, calls `sessionService.endSession()`, and broadcasts `session_ended` to the namespace.
- **12 new service tests** — covers `endSession` status/event/activeSessionId behaviour and `archiveStaleActiveSessions` time-based filtering, event recording, count accuracy, and init-time archival. Total service tests: 42.
- **2 new route tests** — covers `POST /api/sessions/:id/end` with an active session and a missing session. Total route tests: 9.

### Changed
- `src/services/session.service.js` — added `appendEvent()` method; `createSession()` now records `session_started`; `ensureActiveSession()` records `session_auto_created` on auto-create; `appendTurn()` records `conversation_turn_created`.
- `src/services/session.service.js` — added `sanitizeFtsQuery()` utility and `searchTurns()` method for FTS5 full-text search.
- `src/services/session.service.js` — added `endSession()` and `archiveStaleActiveSessions()` methods; constructor now invokes `archiveStaleActiveSessions()` on init (best-effort).
- `src/controllers/session.controller.js` — added `search` handler that delegates to `sessionService.searchTurns()`.
- `src/controllers/session.controller.js` — added `end(req, res)` handler.
- `src/routes/session.routes.js` — added `GET /sessions/search` route, registered before `:id` param routes to avoid Express route collision.
- `src/routes/session.routes.js` — added `POST /sessions/:id/end` route.
- `src/sockets/dataHandler.js` — restructured `handleSttFinal()` to move `ensureActiveSession()` to the top of the handler and record events at each lifecycle stage. Events are wrapped in try/catch to never interrupt the AI answer flow.
- `src/sockets/dataHandler.js` — added `end_session` socket event handler and `handleEndSession()` method.

---

## [2.2.0] — 2026-04-25

### Added
- **Deepgram Cloud STT** — `DEEPGRAM_ENABLED=true` in `.env` switches the transcriber from local Whisper to Deepgram nova-2 cloud streaming. Configurable via settings page: model, language, endpointing, utterance-end timeout, speaker diarize, smart format, min word count.
- **Telemetry fallback log** — when OTel is disabled or the endpoint is unreachable, metrics and log events are now written to `logs/telemetry_node.jsonl` (NDJSON, truncated on each start) instead of being silently dropped.
- **`.env` as single config source** — all runtime settings (API keys, ports, model choices, feature flags, telemetry credentials) now live in a root-level `.env` file shared by Node, Python transcriber, and Electron. `start.sh` loads it directly via a safe `KEY=VALUE` parser (no shell eval).
- **One-time `api-keys.json → .env` migration** — `start.sh` detects the legacy `config/api-keys.json` and automatically migrates known keys into `.env`, then writes `config/.migrated` so it never runs again. The old file is left in place as a backup.
- **`.env.example`** — checked-in template with all supported keys and inline comments.

### Changed
- `src/server.js` — telemetry config now read from `process.env` (`TELEMETRY_ENABLED`, `OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, `GRAFANA_ACCESS_TOKEN`, `TELEMETRY_SERVICE_PREFIX`) instead of `config/api-keys.json`; `dotenv` loaded at the top of the entry point.
- `src/config/constants.js` — `PORT` and `SCREENSHOTS_PATH` now read from `process.env`; `api-keys.json` parsing removed.
- `src/controllers/config.controller.js` — reads and writes `.env` file in-place (preserves comments and key order); supports full Deepgram settings block.
- `src/utils/logger.js` — now delegates `logEvent` to `telemetry.js` directly; `file-logger.js` import removed.
- `electron/main.js` — loads `.env` at startup so `SOCKET_URL` and `HUD_OPACITY` are available without manual env injection.
- `transcriber/config.py` — all config now read from environment variables; `get_telemetry_cfg()` helper added for clean telemetry init.
- `transcriber/main.py` — uses `get_telemetry_cfg()` for OTel init; `log_writer` calls replaced with `telemetry.log()`; conditionally boots `DeepgramListener` when `DEEPGRAM_ENABLED=true`.
- `start.sh` — overhauled: loads `.env` safely, runs migration, passes env to all three services; removed JSON parsing dependency.
- Grafana dashboard (`docs/grafana-dashboard.json`) — expanded with Deepgram STT panels (panel 500 row).

### Removed
- `src/utils/file-logger.js` — replaced by `telemetry.logEvent()` fallback path.
- `src/utils/memory-logger.js` — same replacement.
- `transcriber/log_writer.py` — replaced by `telemetry.log()` calls throughout transcriber.

---

## [2.1.0] — 2026-04-22

### Added
- **Grafana Cloud observability** — OpenTelemetry metrics and structured logs shipped over OTLP HTTP from both the Node.js backend (`src/utils/telemetry.js`) and the Python transcriber (`transcriber/telemetry.py`) to Grafana Cloud. Metrics batch every 10 s; logs queue in a bounded `BatchLogRecordProcessor` (10 k records, 5 s flush). Zero hot-path overhead — all calls are no-ops when disabled or when the endpoint is unreachable.
- **Server-side metrics** — histograms: `ai_ttft_ms`, `ai_total_ms`, `ocr_duration_ms`, `screenshot_pipeline_total_ms`, `end_to_end_question_ms`, `http_request_duration_ms`. Counters: AI provider success/failure, `ai_input_tokens_total`, `ai_output_tokens_total`, `ai_cost_usd_total`, Anthropic prompt-cache hit/write tokens, screenshot and OCR failure counts.
- **Transcriber metrics** — histograms: `vad_latency_ms`, `whisper_decode_ms`, `speaker_id_latency_ms`, `silence_wait_actual_ms`. Counters: utterances detected, passed, and discarded (labeled by reason). Gauges: listener active, Whisper model loaded, speaker ID model status.
- **System resource gauges** (both services) — host CPU %, memory %, process RSS, GPU utilization and memory (NVIDIA via `pynvml`; Apple Silicon MPS via PyTorch). Sampled every 10 s on a daemon thread / unref'd interval.
- **Multi-machine host identity** — `host.id` derived from `IOPlatformUUID` (macOS) or `/etc/machine-id` (Linux); stable across reboots and consistent between Node and Python so logs and metrics can be correlated in Grafana without a join key. Resource attributes include `host.name`, `host.arch`, `device.cpu.brand`, `os.type`, `gpu.vendor`, `gpu.model`.
- **Telemetry middleware** — `src/middleware/telemetry.middleware.js` records `http_request_duration_ms` per Express route.
- **Grafana dashboard + alert rules** — `docs/grafana-dashboard.json` (pre-built dashboard) and `docs/grafana-alert-rules.yaml` (alerts for TTFT p95, provider failure rate, utterance discard rate).
- **Web: `/observability` deep-dive page** — architecture diagram, full metric tables for both services, host identity labels, log migration explanation, and config reference.
- **Web: Grafana observability feature card** — added to the Features section of the landing page.
- **Web: observability article** — added to the LearnMore section linking to `/observability`.
- **OTLP endpoint validation** — `validateOtlpEndpoint()` in `telemetry.js` probes the endpoint before the settings page persists `telemetry.enabled = true`, preventing silent misconfiguration.

### Changed
- `src/utils/file-logger.js` and `src/utils/memory-logger.js` — on-disk NDJSON writers removed; both now delegate to `telemetry.logEvent()` with an identical call-site API. Grafana Cloud (Loki) is now the single log destination.
- `transcriber/log_writer.py` — replaced with `telemetry.log()` delegation; same function signature as before.
- `src/services/ai.service.js` — tighter streaming loop, earlier first-token forwarding, improved provider cool-off tracking.
- `src/services/image-processing.service.js` / `src/services/ocr.service.js` — reduced Sharp and Tesseract overhead on the screenshot pipeline.
- `src/sockets/dataHandler.js` — socket event fan-out optimised; redundant async waits removed.
- `transcriber/streaming_stt.py` / `always_on_listener.py` / `speaker_id.py` — decode loop tightened; speaker ID check moved off the critical path.
- `electron/hud.html` — live-strip rendering improvements.
- `start.sh` / `start.ps1` — updated to reflect new dependency requirements for OTel packages.

### Removed
- `electron/interviewer-notification.html` and `electron/notification-preload.js` — unused notification overlay removed from the Electron process.
- `transcriber/question_extractor.py` — superseded by the AI-side question extraction path.
- On-disk log files (`logs/app.jsonl`, `logs/memory.jsonl`) as primary log destination — replaced by Grafana Loki via OTel.

---

## [2.0.0] — 2026-04-20

### Added
- **Windows support** — `start.bat` / `start.ps1` for Windows 10/11; openai-whisper fallback when MLX is unavailable
- **Streaming STT with LocalAgreement-2** — committed/tentative word separation; HUD live strip shows words as they're spoken
- **Speaker diarization** — pyannote-based speaker ID filters out the interviewer's voice; enroll via settings
- **Multi-provider AI fallback chain** — OpenAI → Groq → Gemini → Anthropic; configurable order in `api-keys.json`
- **Screenshot analysis flow** — `uploads/` folder polling → Sharp preprocessing → Tesseract OCR → AI answer
- **Conversation memory** — last 5 Q&A pairs + async Ollama summarization (max 3 compressed summaries)
- **Hot-reload config** — change API keys or prompts without restarting any service
- **Web landing page** — FAQ, comparison table, and feature deep-dive pages
- **GitHub community files** — SECURITY.md, issue templates, PR template, CODE_OF_CONDUCT, CONTRIBUTING

### Changed
- Electron HUD: `setContentProtection(true)` now confirmed invisible across Zoom, Meet, Teams, Loom, OBS, Discord Go Live
- `start.sh` now manages full lifecycle: Ollama, Node, Python transcriber, log tailing, and graceful Ctrl+C
- Default Whisper model changed from `base` to `small` for better accuracy
- Prompt system fully externalised to `prompts/` — hot-reloaded via `fs.watch`

### Fixed
- Hallucination filtering via `_HALLUCINATIONS` set in `always_on_listener.py`
- MLX timestamp jitter workaround (`COMMIT_TS_TOL_S`) for committed word detection
- RMS gate prevents near-silence from triggering transcription

---

## [1.0.0] — 2025-12-01

### Added
- Initial release: screenshot monitor + OCR + OpenAI/Groq/Gemini streaming answers
- Electron HUD overlay with always-on-top frameless window
- Basic Whisper transcription via Python FastAPI service
- `start.sh` single-command launcher
- Settings page at `http://localhost:4000/settings`
