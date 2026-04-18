# Graph Report - /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi  (2026-04-18)

## Corpus Check
- 64 files · ~54,585 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 517 nodes · 1108 edges · 32 communities detected
- Extraction: 63% EXTRACTED · 37% INFERRED · 0% AMBIGUOUS · INFERRED: 407 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Audio Recording & VAD Pipeline|Audio Recording & VAD Pipeline]]
- [[_COMMUNITY_Always-On Listener Engine|Always-On Listener Engine]]
- [[_COMMUNITY_AI Provider Fallback Chain|AI Provider Fallback Chain]]
- [[_COMMUNITY_Data Handler & Prompt Builder|Data Handler & Prompt Builder]]
- [[_COMMUNITY_AI Service & GPT Routing|AI Service & GPT Routing]]
- [[_COMMUNITY_VAD Base & Engine Abstraction|VAD Base & Engine Abstraction]]
- [[_COMMUNITY_Context & Image Controllers|Context & Image Controllers]]
- [[_COMMUNITY_Interview Transcript Buffer|Interview Transcript Buffer]]
- [[_COMMUNITY_Speaker Identification|Speaker Identification]]
- [[_COMMUNITY_Config Controller & API Keys|Config Controller & API Keys]]
- [[_COMMUNITY_Benchmark Sample Collection|Benchmark Sample Collection]]
- [[_COMMUNITY_Question Extractor|Question Extractor]]
- [[_COMMUNITY_Speaker Embedding Storage|Speaker Embedding Storage]]
- [[_COMMUNITY_Transcriber Config|Transcriber Config]]
- [[_COMMUNITY_Electron Overlay Window|Electron Overlay Window]]
- [[_COMMUNITY_App Constants & Config Loader|App Constants & Config Loader]]
- [[_COMMUNITY_Upload Middleware|Upload Middleware]]
- [[_COMMUNITY_OCR Worker|OCR Worker]]
- [[_COMMUNITY_Speaker ID Rationale|Speaker ID Rationale]]
- [[_COMMUNITY_Transcriber Rationale|Transcriber Rationale]]
- [[_COMMUNITY_Transcriber Rationale|Transcriber Rationale]]
- [[_COMMUNITY_VAD Rationale|VAD Rationale]]
- [[_COMMUNITY_VAD Rationale|VAD Rationale]]
- [[_COMMUNITY_VAD Rationale|VAD Rationale]]
- [[_COMMUNITY_VAD Rationale|VAD Rationale]]
- [[_COMMUNITY_Electron Preload|Electron Preload]]
- [[_COMMUNITY_Express App Entry|Express App Entry]]
- [[_COMMUNITY_Context Routes|Context Routes]]
- [[_COMMUNITY_Image Routes|Image Routes]]
- [[_COMMUNITY_Config Routes|Config Routes]]
- [[_COMMUNITY_Socket.IO Event Map|Socket.IO Event Map]]
- [[_COMMUNITY_Express Backend|Express Backend]]

## God Nodes (most connected - your core abstractions)
1. `DataHandler` - 40 edges
2. `AIService` - 40 edges
3. `SocketClient` - 38 edges
4. `AlwaysOnListener` - 34 edges
5. `AudioRecorder` - 25 edges
6. `KeyboardHandler` - 25 edges
7. `SpeakerIdentifier` - 24 edges
8. `Transcriber` - 24 edges
9. `StreamingSTT` - 23 edges
10. `Full System Architecture Diagram` - 22 edges

## Surprising Connections (you probably didn't know these)
- `Settings Page UI (settings.html)` --references--> `Settings AI Providers Screenshot — Groq→OpenAI→Gemini fallback chain with model selectors`  [INFERRED]
  src/public/settings.html → docs/images/settings-providers.png
- `Settings Page UI (settings.html)` --references--> `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity`  [INFERRED]
  src/public/settings.html → docs/images/settings-details.png
- `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity` --references--> `Settings Interview Role Section`  [EXTRACTED]
  docs/images/settings-details.png → src/public/settings.html
- `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity` --references--> `Settings Screenshots Folder Section`  [EXTRACTED]
  docs/images/settings-details.png → src/public/settings.html
- `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity` --references--> `Settings HUD Appearance Section (Window Opacity Slider)`  [EXTRACTED]
  docs/images/settings-details.png → src/public/settings.html

## Hyperedges (group relationships)
- **Interview Audio Pipeline: Mic → VAD → Whisper → Socket.IO → AI → HUD** — always_on_listener, vad_silero, transcriber_local, python_socketio_client, data_handler, ai_classify_answer, interview_transcript_buffer, hud_qa_viewer [EXTRACTED 0.95]
- **Screenshot Analysis Pipeline: fs.watch → OCR → AI → HUD** — screenshot_monitor, screenshot_crop_retina, ocr_service, image_processing_service, ai_service, data_handler, hud_qa_viewer [EXTRACTED 0.95]
- **AI Multi-Provider System: Config → Fallback Chain → Providers → Backoff** — config_api_keys_json, ai_fallback_chain, ai_provider_openai, ai_provider_groq, ai_provider_gemini, ai_provider_claude, ai_provider_ollama, fallback_backoff_design [EXTRACTED 0.92]

## Communities

### Community 0 - "Audio Recording & VAD Pipeline"
Cohesion: 0.04
Nodes (55): _is_gibberish(), Called by StreamingSTT once VAD silence ≥ 1s (or force_final on stop).         A, AudioRecorder, Real-time audio recorder using sounddevice for microphone capture, Real-time audio recorder with streaming support, BaseModel, errorHandler(), KeyboardHandler (+47 more)

### Community 1 - "Always-On Listener Engine"
Cohesion: 0.04
Nodes (47): AlwaysOnListener, Always-on microphone listener for continuous interviewer speech detection.  Runs, Update VAD thresholds at runtime from a config dict., Get the speech threshold for the current engine., Detect repetitive/gibberish output that Whisper produces on noise., Called by StreamingSTT every ~300ms with the latest partial transcript., Continuously listens to the microphone and emits detected utterances., Reset internal state (e.g. RNN hidden state). No-op by default. (+39 more)

### Community 2 - "AI Provider Fallback Chain"
Cohesion: 0.05
Nodes (70): classifyAndAnswerInterviewQuestion() — Combined Header State Machine, AI Provider Fallback Chain with Exponential Backoff, Claude (Anthropic) Provider (claude-sonnet-4-5), Gemini Provider (gemini-2.5-flash), Groq Provider (llama-3.3-70b-versatile), Ollama Local Provider (llama3.2:1b, localhost:11434), OpenAI Provider (gpt-4o-mini, whisper-1), AI Service (Multi-provider fallback chain) (+62 more)

### Community 3 - "Data Handler & Prompt Builder"
Cohesion: 0.08
Nodes (5): DataHandler, logEvent(), set_always_on_mode(), ScreenshotMonitorService, gracefulShutdown()

### Community 4 - "AI Service & GPT Routing"
Cohesion: 0.12
Nodes (1): AIService

### Community 5 - "VAD Base & Engine Abstraction"
Cohesion: 0.08
Nodes (19): ABC, BaseVAD, is_speech(), Abstract base class for Voice Activity Detection engines., Interface that all VAD engines must implement., update_config(), BaseVAD, create_vad() (+11 more)

### Community 6 - "Context & Image Controllers"
Cohesion: 0.1
Nodes (4): ContextController, ImageController, ImageProcessingService, OCRService

### Community 7 - "Interview Transcript Buffer"
Cohesion: 0.24
Nodes (2): InterviewTranscriptBuffer, logMemory()

### Community 8 - "Speaker Identification"
Cohesion: 0.17
Nodes (5): _cosine_similarity(), SpeakerIdentifier — pyannote-based speaker embedding for voice identification., Returns (is_user, similarity_score).         is_user=True  → audio matches the e, Run pyannote Inference on a numpy audio array → 512-dim embedding., Compute the candidate's voice embedding from raw audio and persist it to disk.

### Community 9 - "Config Controller & API Keys"
Cohesion: 0.33
Nodes (1): ConfigController

### Community 10 - "Benchmark Sample Collection"
Cohesion: 0.42
Nodes (9): import_mode(), import_wav(), interactive_mode(), load_manifest(), main(), Import an existing WAV file. Returns (audio_float32, sample_rate)., record_clip(), save_manifest() (+1 more)

### Community 11 - "Question Extractor"
Cohesion: 0.31
Nodes (3): QuestionExtractor, Pattern-based question extraction, Pattern-based question extractor

### Community 12 - "Speaker Embedding Storage"
Cohesion: 0.5
Nodes (2): Load a previously saved embedding from disk at startup., Args:             hf_token:  HuggingFace access token for downloading the pyanno

### Community 13 - "Transcriber Config"
Cohesion: 0.5
Nodes (3): _load_json_config(), Configuration file for the STT system, Read settings from the shared config file.

### Community 14 - "Electron Overlay Window"
Cohesion: 1.0
Nodes (3): createOverlayWindow(), positionOverlayOnDisplayUnderCursor(), toggleOverlay()

### Community 15 - "App Constants & Config Loader"
Cohesion: 0.67
Nodes (0): 

### Community 16 - "Upload Middleware"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "OCR Worker"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Speaker ID Rationale"
Cohesion: 1.0
Nodes (1): True only when model is loaded AND candidate voice is enrolled.

### Community 19 - "Transcriber Rationale"
Cohesion: 1.0
Nodes (1): Convert a float32 numpy array to in-memory WAV bytes.

### Community 20 - "Transcriber Rationale"
Cohesion: 1.0
Nodes (1): Return the OpenAI API key from env var or config/api-keys.json.

### Community 21 - "VAD Rationale"
Cohesion: 1.0
Nodes (1): Return True if the audio chunk contains speech.

### Community 22 - "VAD Rationale"
Cohesion: 1.0
Nodes (1): Return speech probability in [0.0, 1.0].

### Community 23 - "VAD Rationale"
Cohesion: 1.0
Nodes (1): Update VAD parameters at runtime.

### Community 24 - "VAD Rationale"
Cohesion: 1.0
Nodes (1): Return the engine identifier string.

### Community 25 - "Electron Preload"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Express App Entry"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Context Routes"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Image Routes"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Config Routes"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Socket.IO Event Map"
Cohesion: 1.0
Nodes (1): Socket.IO Event Map

### Community 31 - "Express Backend"
Cohesion: 1.0
Nodes (1): Express.js Backend (REST API, static serving, settings page)

## Knowledge Gaps
- **73 isolated node(s):** `SpeakerIdentifier — pyannote-based speaker embedding for voice identification.`, `Identifies whether an audio segment belongs to the enrolled candidate.`, `Args:             hf_token:  HuggingFace access token for downloading the pyanno`, `Load the pyannote embedding model. Called once at app startup.`, `True only when model is loaded AND candidate voice is enrolled.` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Upload Middleware`** (2 nodes): `fileFilter()`, `upload.middleware.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `OCR Worker`** (2 nodes): `runOCR()`, `ocr.worker.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Speaker ID Rationale`** (1 nodes): `True only when model is loaded AND candidate voice is enrolled.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Transcriber Rationale`** (1 nodes): `Convert a float32 numpy array to in-memory WAV bytes.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Transcriber Rationale`** (1 nodes): `Return the OpenAI API key from env var or config/api-keys.json.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VAD Rationale`** (1 nodes): `Return True if the audio chunk contains speech.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VAD Rationale`** (1 nodes): `Return speech probability in [0.0, 1.0].`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VAD Rationale`** (1 nodes): `Update VAD parameters at runtime.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VAD Rationale`** (1 nodes): `Return the engine identifier string.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Electron Preload`** (1 nodes): `preload.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Express App Entry`** (1 nodes): `app.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Context Routes`** (1 nodes): `context.routes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Image Routes`** (1 nodes): `image.routes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Config Routes`** (1 nodes): `config.routes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Socket.IO Event Map`** (1 nodes): `Socket.IO Event Map`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Express Backend`** (1 nodes): `Express.js Backend (REST API, static serving, settings page)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AlwaysOnListener (VAD State Machine, 100ms audio blocks)` connect `AI Provider Fallback Chain` to `Audio Recording & VAD Pipeline`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Why does `AlwaysOnListener` connect `Always-On Listener Engine` to `Audio Recording & VAD Pipeline`, `Data Handler & Prompt Builder`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `SocketClient` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`SocketClient` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `AlwaysOnListener` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`AlwaysOnListener` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `AudioRecorder` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`AudioRecorder` has 15 INFERRED edges - model-reasoned connections that need verification._
- **What connects `SpeakerIdentifier — pyannote-based speaker embedding for voice identification.`, `Identifies whether an audio segment belongs to the enrolled candidate.`, `Args:             hf_token:  HuggingFace access token for downloading the pyanno` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Audio Recording & VAD Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._