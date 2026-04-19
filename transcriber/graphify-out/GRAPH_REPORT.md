# Graph Report - /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber  (2026-04-18)

## Corpus Check
- Corpus is ~11,838 words - fits in a single context window. You may not need a graph.

## Summary
- 306 nodes · 519 edges · 34 communities detected
- Extraction: 63% EXTRACTED · 37% INFERRED · 0% AMBIGUOUS · INFERRED: 193 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Audio Recording|Audio Recording]]
- [[_COMMUNITY_VAD Base Layer|VAD Base Layer]]
- [[_COMMUNITY_Always-On Listener|Always-On Listener]]
- [[_COMMUNITY_Socket.IO Transport|Socket.IO Transport]]
- [[_COMMUNITY_Streaming STT Engine|Streaming STT Engine]]
- [[_COMMUNITY_VAD Metrics & Init|VAD Metrics & Init]]
- [[_COMMUNITY_FastAPI Endpoints|FastAPI Endpoints]]
- [[_COMMUNITY_Speaker Identification|Speaker Identification]]
- [[_COMMUNITY_VAD Benchmark|VAD Benchmark]]
- [[_COMMUNITY_Benchmark Tooling|Benchmark Tooling]]
- [[_COMMUNITY_Question Extractor|Question Extractor]]
- [[_COMMUNITY_Config System|Config System]]
- [[_COMMUNITY_PyAnnote  Torch|PyAnnote / Torch]]
- [[_COMMUNITY_MLX Whisper (Apple Silicon)|MLX Whisper (Apple Silicon)]]
- [[_COMMUNITY_NLP Dependencies|NLP Dependencies]]
- [[_COMMUNITY_Silero VAD|Silero VAD]]
- [[_COMMUNITY_Log Writer|Log Writer]]
- [[_COMMUNITY_Keyboard Handler|Keyboard Handler]]
- [[_COMMUNITY_WebRTC VAD|WebRTC VAD]]
- [[_COMMUNITY_Transcriber Core|Transcriber Core]]
- [[_COMMUNITY_OpenAI API Backend|OpenAI API Backend]]
- [[_COMMUNITY_Audio Utilities|Audio Utilities]]
- [[_COMMUNITY_SoundDevice|SoundDevice]]
- [[_COMMUNITY_FastAPI & ASGI|FastAPI & ASGI]]
- [[_COMMUNITY_Socket.IO Deps|Socket.IO Deps]]
- [[_COMMUNITY_Async HTTP|Async HTTP]]
- [[_COMMUNITY_Data Validation|Data Validation]]
- [[_COMMUNITY_Env Config|Env Config]]
- [[_COMMUNITY_Input Devices|Input Devices]]
- [[_COMMUNITY_Audio Processing|Audio Processing]]
- [[_COMMUNITY_Benchmark Deps|Benchmark Deps]]
- [[_COMMUNITY_ONNX Runtime|ONNX Runtime]]
- [[_COMMUNITY_VAD Comparison|VAD Comparison]]
- [[_COMMUNITY_Manifest & Samples|Manifest & Samples]]

## God Nodes (most connected - your core abstractions)
1. `SocketClient` - 38 edges
2. `AlwaysOnListener` - 33 edges
3. `AudioRecorder` - 25 edges
4. `KeyboardHandler` - 25 edges
5. `SpeakerIdentifier` - 24 edges
6. `Transcriber` - 24 edges
7. `StreamingSTT` - 23 edges
8. `VADMetrics` - 19 edges
9. `lifespan()` - 14 edges
10. `BaseVAD` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Detect repetitive/gibberish output that Whisper produces on noise.` --uses--> `StreamingSTT`  [INFERRED]
  /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber/always_on_listener.py → /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber/streaming_stt.py
- `WebRTC VAD engine` --references--> `webrtcvad`  [INFERRED]
  benchmark/README.md → requirements.txt
- `Silero VAD engine` --references--> `onnxruntime`  [INFERRED]
  benchmark/README.md → requirements.txt
- `StartRecordingResponse` --uses--> `SpeakerIdentifier`  [INFERRED]
  /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber/main.py → /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber/speaker_id.py
- `StopRecordingResponse` --uses--> `SpeakerIdentifier`  [INFERRED]
  /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber/main.py → /Users/parmeet1.0/Documents/workspaces/nodeWorkspace/solveWatchAi/transcriber/speaker_id.py

## Communities

### Community 0 - "Audio Recording"
Cohesion: 0.08
Nodes (23): AudioRecorder, Real-time audio recorder using sounddevice for microphone capture, Real-time audio recorder with streaming support, BaseModel, KeyboardHandler, Keyboard handler for push-to-record feature, Handles keyboard input for push-to-record functionality, get_enrollment_status() (+15 more)

### Community 1 - "VAD Base Layer"
Cohesion: 0.08
Nodes (20): ABC, BaseVAD, is_speech(), Abstract base class for Voice Activity Detection engines., Reset internal state (e.g. RNN hidden state). No-op by default., Interface that all VAD engines must implement., speech_probability(), BaseVAD (+12 more)

### Community 2 - "Always-On Listener"
Cohesion: 0.09
Nodes (17): AlwaysOnListener, _is_gibberish(), Always-on microphone listener for continuous interviewer speech detection.  Runs, Update VAD thresholds at runtime from a config dict., Get the speech threshold for the current engine., Called by StreamingSTT once VAD silence ≥ 1s (or force_final on stop).         A, Continuously listens to the microphone and emits detected utterances., update_config() (+9 more)

### Community 3 - "Socket.IO Transport"
Cohesion: 0.08
Nodes (10): Called by StreamingSTT every ~300ms with the latest partial transcript., Socket.IO client for sending transcription chunks and questions.  Improvements o, Attempt immediate connection. On failure, start background retry loop., Keep trying to connect with exponential backoff (1 s → 2 s → … → 30 s max)., Socket.IO client with automatic infinite reconnection., Send a detected interviewer utterance to the server for question classification., Emit streaming partial transcript — committed (stable) + tentative (may change)., Notify Node.js that the always-on listener was toggled via keyboard. (+2 more)

### Community 4 - "Streaming STT Engine"
Cohesion: 0.09
Nodes (13): StreamingSTT — rolling-buffer streaming decoder on top of MLX Whisper.  Decodes, Append a 100ms audio chunk to the rolling buffer.         Called from sounddevic, Tell the decode loop whether VAD currently reports silence.         Called from, Transcribe audio with word-level timestamps.         Returns list of (word, abs_, Extend the committed prefix.          A word at position i is committed when:, Drop buffer chunks whose end-time falls before prune_before.         Called unde, Reset all state after emitting a final. Called from decode thread or force_final, Rolling-buffer streaming decoder with LocalAgreement-2 stabilisation. (+5 more)

### Community 5 - "VAD Metrics & Init"
Cohesion: 0.1
Nodes (18): Detect repetitive/gibberish output that Whisper produces on noise., get_vad_metrics(), Return rolling VAD metrics summary (5-minute window)., Thread-safe VAD metrics with a rolling 5-minute window., Remove entries older than the rolling window. Must hold self._lock., Record a single VAD chunk decision. Returns the record dict., Record a flushed utterance with its metrics. Returns the record dict., Collects per-chunk and per-utterance VAD metrics.      All data is kept in a rol (+10 more)

### Community 6 - "FastAPI Endpoints"
Cohesion: 0.13
Nodes (14): append_transcription_to_json(), health_check(), process_audio_chunk(), Accumulate an audio chunk and transcribe when enough audio is buffered.      All, Stop recording, transcribe remaining audio, and signal the server.      Executio, Queue a transcription entry for async NDJSON file writing (non-blocking)., stop_recording_internal_sync(), Send a transcription text chunk to the server (synchronous/blocking). (+6 more)

### Community 7 - "Speaker Identification"
Cohesion: 0.12
Nodes (12): lifespan(), load_speaker_id_endpoint(), Dynamically load (or reload) the pyannote speaker ID model.     Called when the, _cosine_similarity(), SpeakerIdentifier — pyannote-based speaker embedding for voice identification., Load a previously saved embedding from disk at startup., Returns (is_user, similarity_score).         is_user=True  → audio matches the e, Run pyannote Inference on a numpy audio array → 512-dim embedding. (+4 more)

### Community 8 - "VAD Benchmark"
Cohesion: 0.17
Nodes (12): 100ms chunk size matches live pipeline — rationale for benchmark chunk size, Benchmark Metrics (Accuracy, Precision, Recall, F1, Latency), collect_samples.py, F1 Score as overall balance metric — rationale for recommendation logic, manifest.json, run_benchmark.py, Silero VAD engine, VAD Benchmark (+4 more)

### Community 9 - "Benchmark Tooling"
Cohesion: 0.42
Nodes (9): import_mode(), import_wav(), interactive_mode(), load_manifest(), main(), Import an existing WAV file. Returns (audio_float32, sample_rate)., record_clip(), save_manifest() (+1 more)

### Community 10 - "Question Extractor"
Cohesion: 0.31
Nodes (3): QuestionExtractor, Pattern-based question extraction, Pattern-based question extractor

### Community 11 - "Config System"
Cohesion: 0.5
Nodes (3): _load_json_config(), Configuration file for the STT system, Read settings from the shared config file.

### Community 12 - "PyAnnote / Torch"
Cohesion: 0.5
Nodes (4): pyannote requires HuggingFace token + model acceptance — rationale for pyannote.audio dependency, pyannote.audio, torch, torchaudio

### Community 13 - "MLX Whisper (Apple Silicon)"
Cohesion: 1.0
Nodes (3): MLX requires Apple Silicon (M1/M2/M3) Mac — rationale for mlx/mlx-whisper dependency, mlx, mlx-whisper

### Community 14 - "NLP Dependencies"
Cohesion: 0.67
Nodes (3): scikit-learn, sentencepiece, transformers

### Community 15 - "Silero VAD"
Cohesion: 1.0
Nodes (2): python-socketio, websocket-client

### Community 16 - "Log Writer"
Cohesion: 1.0
Nodes (1): True only when model is loaded AND candidate voice is enrolled.

### Community 17 - "Keyboard Handler"
Cohesion: 1.0
Nodes (1): Convert a float32 numpy array to in-memory WAV bytes.

### Community 18 - "WebRTC VAD"
Cohesion: 1.0
Nodes (1): Return the OpenAI API key from env var or config/api-keys.json.

### Community 19 - "Transcriber Core"
Cohesion: 1.0
Nodes (1): Return True if the audio chunk contains speech.

### Community 20 - "OpenAI API Backend"
Cohesion: 1.0
Nodes (1): Return speech probability in [0.0, 1.0].

### Community 21 - "Audio Utilities"
Cohesion: 1.0
Nodes (1): Update VAD parameters at runtime.

### Community 22 - "SoundDevice"
Cohesion: 1.0
Nodes (1): Return the engine identifier string.

### Community 23 - "FastAPI & ASGI"
Cohesion: 1.0
Nodes (1): fastapi

### Community 24 - "Socket.IO Deps"
Cohesion: 1.0
Nodes (1): uvicorn[standard]

### Community 25 - "Async HTTP"
Cohesion: 1.0
Nodes (1): aiohttp

### Community 26 - "Data Validation"
Cohesion: 1.0
Nodes (1): sounddevice

### Community 27 - "Env Config"
Cohesion: 1.0
Nodes (1): numpy

### Community 28 - "Input Devices"
Cohesion: 1.0
Nodes (1): librosa

### Community 29 - "Audio Processing"
Cohesion: 1.0
Nodes (1): soundfile

### Community 30 - "Benchmark Deps"
Cohesion: 1.0
Nodes (1): openai

### Community 31 - "ONNX Runtime"
Cohesion: 1.0
Nodes (1): pydantic

### Community 32 - "VAD Comparison"
Cohesion: 1.0
Nodes (1): python-dotenv

### Community 33 - "Manifest & Samples"
Cohesion: 1.0
Nodes (1): pynput

## Knowledge Gaps
- **85 isolated node(s):** `SpeakerIdentifier — pyannote-based speaker embedding for voice identification.`, `Identifies whether an audio segment belongs to the enrolled candidate.`, `Args:             hf_token:  HuggingFace access token for downloading the pyanno`, `Load the pyannote embedding model. Called once at app startup.`, `True only when model is loaded AND candidate voice is enrolled.` (+80 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Silero VAD`** (2 nodes): `python-socketio`, `websocket-client`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Log Writer`** (1 nodes): `True only when model is loaded AND candidate voice is enrolled.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Keyboard Handler`** (1 nodes): `Convert a float32 numpy array to in-memory WAV bytes.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `WebRTC VAD`** (1 nodes): `Return the OpenAI API key from env var or config/api-keys.json.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Transcriber Core`** (1 nodes): `Return True if the audio chunk contains speech.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `OpenAI API Backend`** (1 nodes): `Return speech probability in [0.0, 1.0].`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audio Utilities`** (1 nodes): `Update VAD parameters at runtime.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SoundDevice`** (1 nodes): `Return the engine identifier string.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `FastAPI & ASGI`** (1 nodes): `fastapi`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Socket.IO Deps`** (1 nodes): `uvicorn[standard]`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Async HTTP`** (1 nodes): `aiohttp`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Data Validation`** (1 nodes): `sounddevice`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Env Config`** (1 nodes): `numpy`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Input Devices`** (1 nodes): `librosa`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Audio Processing`** (1 nodes): `soundfile`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Benchmark Deps`** (1 nodes): `openai`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ONNX Runtime`** (1 nodes): `pydantic`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `VAD Comparison`** (1 nodes): `python-dotenv`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Manifest & Samples`** (1 nodes): `pynput`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AlwaysOnListener` connect `Always-On Listener` to `Audio Recording`, `Socket.IO Transport`, `Streaming STT Engine`, `VAD Metrics & Init`, `FastAPI Endpoints`, `Speaker Identification`?**
  _High betweenness centrality (0.236) - this node is a cross-community bridge._
- **Why does `SocketClient` connect `Socket.IO Transport` to `Audio Recording`, `Always-On Listener`, `VAD Metrics & Init`, `FastAPI Endpoints`, `Speaker Identification`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._
- **Why does `StreamingSTT` connect `Streaming STT Engine` to `Always-On Listener`, `Socket.IO Transport`, `VAD Metrics & Init`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `SocketClient` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`SocketClient` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `AlwaysOnListener` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`AlwaysOnListener` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `AudioRecorder` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`AudioRecorder` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `KeyboardHandler` (e.g. with `StartRecordingResponse` and `StopRecordingResponse`) actually correct?**
  _`KeyboardHandler` has 15 INFERRED edges - model-reasoned connections that need verification._