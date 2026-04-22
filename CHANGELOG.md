# Changelog

All notable changes to SolveWatch AI are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
