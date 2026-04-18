# Graph Report - /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi  (2026-04-18)

## Corpus Check
- 41 files · ~97,302 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 516 nodes · 1098 edges · 32 communities detected
- Extraction: 64% EXTRACTED · 36% INFERRED · 0% AMBIGUOUS · INFERRED: 399 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]

## God Nodes (most connected - your core abstractions)
1. `DataHandler` - 40 edges
2. `AIService` - 40 edges
3. `SocketClient` - 38 edges
4. `AlwaysOnListener` - 33 edges
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
- `Settings Interview Role Section` --references--> `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity`  [EXTRACTED]
  src/public/settings.html → docs/images/settings-details.png
- `Settings Screenshots Folder Section` --references--> `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity`  [EXTRACTED]
  src/public/settings.html → docs/images/settings-details.png
- `Settings HUD Appearance Section (Window Opacity Slider)` --references--> `Settings Details Screenshot — Interview Role, Screenshots folder, STT mode, HUD opacity`  [EXTRACTED]
  src/public/settings.html → docs/images/settings-details.png

## Hyperedges (group relationships)
- **Interview Audio Pipeline: Mic → VAD → Whisper → Socket.IO → AI → HUD** — always_on_listener, vad_silero, transcriber_local, python_socketio_client, data_handler, ai_classify_answer, interview_transcript_buffer, hud_qa_viewer [EXTRACTED 0.95]
- **Screenshot Analysis Pipeline: fs.watch → OCR → AI → HUD** — screenshot_monitor, screenshot_crop_retina, ocr_service, image_processing_service, ai_service, data_handler, hud_qa_viewer [EXTRACTED 0.95]
- **AI Multi-Provider System: Config → Fallback Chain → Providers → Backoff** — config_api_keys_json, ai_fallback_chain, ai_provider_openai, ai_provider_groq, ai_provider_gemini, ai_provider_claude, ai_provider_ollama, fallback_backoff_design [EXTRACTED 0.92]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (37): AlwaysOnListener, _is_gibberish(), Always-on microphone listener for continuous interviewer speech detection.  Runs, Update VAD thresholds at runtime from a config dict., Get the speech threshold for the current engine., Detect repetitive/gibberish output that Whisper produces on noise., Called by StreamingSTT every ~300ms with the latest partial transcript., Called by StreamingSTT once VAD silence ≥ 1s (or force_final on stop).         A (+29 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (41): AudioRecorder, Real-time audio recorder using sounddevice for microphone capture, Real-time audio recorder with streaming support, BaseModel, KeyboardHandler, Keyboard handler for push-to-record feature, Handles keyboard input for push-to-record functionality, append_transcription_to_json() (+33 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (70): classifyAndAnswerInterviewQuestion() — Combined Header State Machine, AI Provider Fallback Chain with Exponential Backoff, Claude (Anthropic) Provider (claude-sonnet-4-5), Gemini Provider (gemini-2.5-flash), Groq Provider (llama-3.3-70b-versatile), Ollama Local Provider (llama3.2:1b, localhost:11434), OpenAI Provider (gpt-4o-mini, whisper-1), AI Service (Multi-provider fallback chain) (+62 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (5): DataHandler, logEvent(), set_always_on_mode(), ScreenshotMonitorService, gracefulShutdown()

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (18): errorHandler(), ImageController, Logger, health_check(), json_writer_worker(), process_audio_chunk(), Socket.IO client for sending transcription chunks and questions.  Improvements o, Attempt immediate connection. On failure, start background retry loop. (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (28): ABC, BaseVAD, is_speech(), Abstract base class for Voice Activity Detection engines., Reset internal state (e.g. RNN hidden state). No-op by default., Interface that all VAD engines must implement., speech_probability(), BaseVAD (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (1): AIService

### Community 7 - "Community 7"
Cohesion: 0.24
Nodes (2): InterviewTranscriptBuffer, logMemory()

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (3): ContextController, ImageProcessingService, OCRService

### Community 9 - "Community 9"
Cohesion: 0.17
Nodes (5): _cosine_similarity(), SpeakerIdentifier — pyannote-based speaker embedding for voice identification., Returns (is_user, similarity_score).         is_user=True  → audio matches the e, Run pyannote Inference on a numpy audio array → 512-dim embedding., Compute the candidate's voice embedding from raw audio and persist it to disk.

### Community 10 - "Community 10"
Cohesion: 0.33
Nodes (1): ConfigController

### Community 11 - "Community 11"
Cohesion: 0.42
Nodes (9): import_mode(), import_wav(), interactive_mode(), load_manifest(), main(), Import an existing WAV file. Returns (audio_float32, sample_rate)., record_clip(), save_manifest() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.31
Nodes (3): QuestionExtractor, Pattern-based question extraction, Pattern-based question extractor

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (3): _load_json_config(), Configuration file for the STT system, Read settings from the shared config file.

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (3): createOverlayWindow(), positionOverlayOnDisplayUnderCursor(), toggleOverlay()

### Community 15 - "Community 15"
Cohesion: 0.67
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (1): True only when model is loaded AND candidate voice is enrolled.

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (1): Convert a float32 numpy array to in-memory WAV bytes.

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (1): Return the OpenAI API key from env var or config/api-keys.json.

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (1): Return True if the audio chunk contains speech.

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (1): Return speech probability in [0.0, 1.0].

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (1): Update VAD parameters at runtime.

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): Return the engine identifier string.

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): Socket.IO Event Map

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (1): Express.js Backend (REST API, static serving, settings page)

## Knowledge Gaps
- **73 isolated node(s):** `SpeakerIdentifier — pyannote-based speaker embedding for voice identification.`, `Identifies whether an audio segment belongs to the enrolled candidate.`, `Args:             hf_token:  HuggingFace access token for downloading the pyanno`, `Load the pyannote embedding model. Called once at app startup.`, `True only when model is loaded AND candidate voice is enrolled.` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (2 nodes): `fileFilter()`, `upload.middleware.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `runOCR()`, `ocr.worker.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (1 nodes): `True only when model is loaded AND candidate voice is enrolled.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `Convert a float32 numpy array to in-memory WAV bytes.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `Return the OpenAI API key from env var or config/api-keys.json.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `Return True if the audio chunk contains speech.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `Return speech probability in [0.0, 1.0].`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `Update VAD parameters at runtime.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `Return the engine identifier string.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `preload.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `app.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `context.routes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `image.routes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `config.routes.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `Socket.IO Event Map`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `Express.js Backend (REST API, static serving, settings page)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AlwaysOnListener (VAD State Machine, 100ms audio blocks)` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Why does `AlwaysOnListener` connect `Community 0` to `Community 1`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `SocketClient` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`SocketClient` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `AlwaysOnListener` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`AlwaysOnListener` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `AudioRecorder` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`AudioRecorder` has 15 INFERRED edges - model-reasoned connections that need verification._
- **What connects `SpeakerIdentifier — pyannote-based speaker embedding for voice identification.`, `Identifies whether an audio segment belongs to the enrolled candidate.`, `Args:             hf_token:  HuggingFace access token for downloading the pyanno` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._