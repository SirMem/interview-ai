"""
FastAPI server for real-time speech-to-text transcription
"""
import asyncio
import logging
import os
import warnings
warnings.filterwarnings("ignore", message=".*unauthenticated.*HF Hub.*", category=UserWarning)
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import numpy as np

from audio_recorder import AudioRecorder
from transcriber import Transcriber
from socket_client import SocketClient
from keyboard_handler import KeyboardHandler
from always_on_listener import AlwaysOnListener
from speaker_id import SpeakerIdentifier
import log_writer
import telemetry
from config import SAMPLE_RATE, API_HOST, API_PORT, LOG_LEVEL, KEYBOARD_ENABLED, SPEAKER_ID_THRESHOLD, SPEAKER_ID_ENABLED, _app_cfg

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global transcriber, socket_client, keyboard_handler, always_on_listener, speaker_identifier
    global _transcription_executor

    logger.info("Initializing STT system components...")

    _start_time = time.monotonic()

    # Initialize OpenTelemetry → Grafana Cloud (no-op when telemetry.enabled=false).
    telemetry.init_telemetry(_app_cfg)
    # Background sampler that emits host CPU / memory / GPU gauges every 10 s.
    # Cheap (~1 ms per tick) and stays active even when telemetry is disabled
    # (gauges are no-ops in that case).
    if telemetry.is_enabled():
        telemetry.start_system_metrics_sampler(interval_seconds=10.0)

    try:
        transcriber = Transcriber()
        logger.info("Transcriber initialized")
        log_writer.log('transcriber_initialized', model=transcriber.model_size, use_api=transcriber.use_api)
        try:
            telemetry.GAUGE_WHISPER_MODEL_LOADED.set(
                1, {"model_name": transcriber.model_size or 'unknown',
                    "backend":    getattr(transcriber, 'backend', 'mlx')},
            )
        except Exception:
            pass

        # Pre-warm: load model weights into GPU memory and trigger Metal JIT compile.
        # Without this, the first real question pays a 2-5s cold-start penalty.
        if not transcriber.use_api:
            try:
                logger.info("Pre-warming Whisper (compiling kernels)...")
                _dummy_audio = np.zeros(16000, dtype=np.float32)  # 1s silence
                if transcriber.backend == "mlx":
                    transcriber._transcribe_mlx(_dummy_audio)
                else:
                    transcriber._transcribe_local_cpu(_dummy_audio)
                logger.info("Whisper pre-warmed successfully")
                log_writer.log('transcriber_prewarmed', model=transcriber.model_size)
            except Exception as _e:
                logger.warning(f"Pre-warm failed (non-fatal, first question will be slower): {_e}")

        # Speaker identification — load ECAPA model if enabled.
        # Fix #7: track status so we can tell HUD why auto-answer is off.
        # Values: 'ok' | 'disabled' | 'load_failed' | 'not_enrolled'
        _speaker_id_status = 'disabled'
        if SPEAKER_ID_ENABLED:
            try:
                logger.info("Loading speaker identification model (ECAPA-TDNN)...")
                speaker_identifier = SpeakerIdentifier(threshold=SPEAKER_ID_THRESHOLD)
                speaker_identifier.load_model()
                if speaker_identifier.is_model_loaded:
                    if speaker_identifier.has_enrollment:
                        _speaker_id_status = 'ok'
                        logger.info("SpeakerIdentifier ready (enrolled, device=%s)",
                                    speaker_identifier.device)
                    else:
                        _speaker_id_status = 'not_enrolled'
                        logger.info("SpeakerIdentifier loaded but not enrolled — open Settings to enroll")
                else:
                    _speaker_id_status = 'load_failed'
                    logger.error("SpeakerIdentifier: model failed to load")
                    speaker_identifier = None
                log_writer.log('speaker_id_initialized', status=_speaker_id_status)
            except Exception as _e:
                logger.error(f"SpeakerIdentifier init failed: {_e}")
                speaker_identifier = None
                _speaker_id_status = 'load_failed'
        else:
            logger.info("Speaker identification disabled in config")

        # Fix #8 — publish current speaker-ID status as a gauge for the Grafana dashboard.
        try:
            telemetry.GAUGE_SPEAKER_ID_MODEL_STATUS.set(1, {"status": _speaker_id_status})
        except Exception:
            pass

        # MLX is protected by an internal lock in transcriber.py — one worker
        # handles preprocessing concurrently while the other waits for the GPU.
        _transcription_executor = ThreadPoolExecutor(
            max_workers=2,
            thread_name_prefix="transcribe",
        )
        logger.info("Transcription thread pool initialized (max_workers=2)")

        socket_client = SocketClient()
        try:
            socket_client.connect()
            logger.info("Socket.IO client connecting (background retry enabled)")
        except Exception as e:
            logger.warning(f"Could not connect to Socket.IO server: {e}")
            logger.warning("Background reconnect is active")

        # Fix #7: if speaker ID was supposed to be active but isn't usable, disable
        # auto-answer so the AI doesn't respond to the candidate's own voice.
        _auto_answer_disabled = (SPEAKER_ID_ENABLED
                                 and _speaker_id_status in ('load_failed', 'not_enrolled'))
        if _auto_answer_disabled:
            logger.warning("Auto-answer disabled (speaker_id=%s). Manual mode (⌘⇧X) still works.",
                           _speaker_id_status)

        try:
            always_on_listener = AlwaysOnListener(
                transcriber, socket_client,
                speaker_id=speaker_identifier,
                auto_answer_disabled=_auto_answer_disabled,
            )
            logger.info("Always-on listener ready (press ⌘⇧X or click Listen to start)")
        except Exception as e:
            logger.warning(f"Could not initialize always-on listener: {e}")
            always_on_listener = None

        # Fix #7: emit speaker-ID status so the HUD can show a banner.
        # Done after socket_client is connecting; it'll reach Node once the connection completes.
        try:
            if socket_client and _speaker_id_status in ('load_failed', 'not_enrolled'):
                socket_client.send_speaker_id_status(_speaker_id_status)
        except Exception as _e:
            logger.debug("Could not send speaker_id_status (socket likely not connected yet): %s", _e)

        if KEYBOARD_ENABLED:
            try:
                def toggle_always_on_keyboard():
                    if always_on_listener is None:
                        return
                    if always_on_listener._running:
                        always_on_listener.stop()
                        log_writer.log('listen_stopped', source='keyboard')
                        if socket_client and socket_client.is_connected():
                            socket_client.send_listen_state(False)
                    else:
                        always_on_listener.start()
                        log_writer.log('listen_started', source='keyboard')
                        if socket_client and socket_client.is_connected():
                            socket_client.send_listen_state(True)

                keyboard_handler = KeyboardHandler(
                    on_key_press=toggle_always_on_keyboard,
                    on_key_release=lambda: None,
                )
                keyboard_handler.start()
                logger.info("Keyboard handler started (toggle always-on mode)")
            except Exception as e:
                logger.warning(f"Could not start keyboard handler: {e}")
                keyboard_handler = None
        else:
            logger.info("Keyboard handler disabled in configuration")

        logger.info("STT system ready")
        # Ensure listener_active is always exported (0 = not listening yet)
        telemetry.GAUGE_LISTENER_ACTIVE.set(0, telemetry.get_host_labels() or None)
        telemetry.log('transcriber_start', 'INFO',
                      pid=os.getpid(),
                      platform=sys.platform,
                      python_version=sys.version.split()[0],
                      whisper_model=getattr(transcriber, 'model_size', 'unknown'),
                      whisper_backend=os.environ.get('WHISPER_BACKEND', 'unknown'),
                      speaker_id_enabled=SPEAKER_ID_ENABLED,
                      start_time=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))

    except Exception as e:
        logger.error(f"Failed to initialize STT system: {e}")
        raise

    yield

    # Shutdown
    global recorder, is_recording, _audio_buffer

    logger.info("Shutting down STT system...")

    if always_on_listener:
        always_on_listener.stop()

    if keyboard_handler:
        keyboard_handler.stop()

    if is_recording:
        stop_recording_internal_sync()

    if _transcription_executor:
        logger.info("Shutting down transcription thread pool...")
        _transcription_executor.shutdown(wait=True)
        _transcription_executor = None

    if socket_client:
        socket_client.disconnect()

    telemetry.log('transcriber_stop', 'INFO',
                  pid=os.getpid(),
                  uptime_seconds=round(time.monotonic() - _start_time),
                  stop_time=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    telemetry.stop_system_metrics_sampler()
    telemetry.shutdown_telemetry()
    logger.info("STT system shut down")


# ---------------------------------------------------------------------------
# App & global state
# ---------------------------------------------------------------------------
app = FastAPI(title="Real-time Speech-to-Text Transcription", lifespan=lifespan)

recorder: Optional[AudioRecorder] = None
transcriber: Optional[Transcriber] = None
socket_client: Optional[SocketClient] = None
recording_thread: Optional[threading.Thread] = None
keyboard_handler: Optional[KeyboardHandler] = None
always_on_listener: Optional[AlwaysOnListener] = None
speaker_identifier: Optional[SpeakerIdentifier] = None
_transcription_executor: Optional[ThreadPoolExecutor] = None

is_recording: bool = False
_send_realtime_chunks: bool = True

# Minimum accumulated audio before attempting transcription.
# 0.5 s is the minimum Whisper supports and halves first-chunk latency.
_min_audio_duration: float = 0.5

# Thread-safe audio accumulation buffer
_audio_buffer: list = []
_audio_buffer_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class StartRecordingResponse(BaseModel):
    status: str
    message: str


class StopRecordingResponse(BaseModel):
    status: str
    message: str


# ---------------------------------------------------------------------------
# Audio processing
# ---------------------------------------------------------------------------
def process_audio_chunk(audio_chunk: np.ndarray):
    """Accumulate an audio chunk and transcribe when enough audio is buffered.

    All reads/writes to ``_audio_buffer`` are protected by ``_audio_buffer_lock``
    so that concurrent worker threads cannot corrupt the buffer or produce
    duplicate transcriptions for the same audio window.
    """
    global transcriber, socket_client, _audio_buffer, _send_realtime_chunks

    try:
        if audio_chunk is None or audio_chunk.size == 0:
            return

        if audio_chunk.ndim > 1:
            audio_chunk = np.mean(audio_chunk, axis=1)

        accumulated_audio: Optional[np.ndarray] = None

        with _audio_buffer_lock:
            _audio_buffer.append(audio_chunk)

            if _send_realtime_chunks:
                total_samples = sum(len(c) for c in _audio_buffer)
                total_duration = total_samples / SAMPLE_RATE

                if total_duration >= _min_audio_duration:
                    # Snapshot and reset buffer atomically
                    accumulated_audio = np.concatenate(_audio_buffer)

                    # Keep 0.5 s of overlap for context continuity
                    overlap_samples = int(SAMPLE_RATE * 0.5)
                    last_chunk = _audio_buffer[-1]
                    if len(last_chunk) > overlap_samples:
                        _audio_buffer = [last_chunk[-overlap_samples:]]
                    else:
                        _audio_buffer = [last_chunk]

        # Transcribe outside the lock (MLX is slow — ~200–500 ms)
        if accumulated_audio is not None and transcriber:
            text = transcriber.transcribe_chunk(accumulated_audio, SAMPLE_RATE)

            if text and text.strip():
                logger.info(f"🎤 Transcription: {text}")
                print(f"🎤 Transcription: {text}")

                if socket_client and socket_client.is_connected():
                    socket_client.send_transcription_chunk(text)

                if text and text.strip():
                    telemetry.log('transcription', text=text.strip())

    except Exception as e:
        logger.error(f"Error processing audio chunk: {e}")
        with _audio_buffer_lock:
            _audio_buffer = []


def recording_worker():
    """Continuously pull audio chunks and dispatch them to the thread pool."""
    global recorder, is_recording, _transcription_executor

    logger.info("Recording worker started")

    while is_recording and recorder:
        try:
            audio_chunk = recorder.get_audio_chunk(timeout=0.5)
            if audio_chunk is not None:
                if _transcription_executor:
                    _transcription_executor.submit(process_audio_chunk, audio_chunk)
                else:
                    threading.Thread(
                        target=process_audio_chunk,
                        args=(audio_chunk,),
                        daemon=True,
                    ).start()
        except Exception as e:
            logger.error(f"Error in recording worker: {e}")
            if not is_recording:
                break

    logger.info("Recording worker stopped")


def start_recording_internal(enable_realtime_chunks: bool = False):
    """Start recording. Called from both keyboard handler and API endpoint."""
    global recorder, recording_thread, is_recording, _audio_buffer, _send_realtime_chunks

    if is_recording:
        logger.warning("Recording is already in progress")
        return

    try:
        with _audio_buffer_lock:
            _audio_buffer = []
        _send_realtime_chunks = enable_realtime_chunks

        recorder = AudioRecorder(callback=None)
        recorder.start_recording()

        is_recording = True
        recording_thread = threading.Thread(target=recording_worker, daemon=True)
        recording_thread.start()

        mode = "real-time" if enable_realtime_chunks else "push-to-talk"
        logger.info(f"Recording started ({mode} mode)")
    except Exception as e:
        logger.error(f"Failed to start recording: {e}")
        is_recording = False
        raise


def stop_recording_internal_sync():
    """Stop recording, transcribe remaining audio, and signal the server.

    Execution order that guarantees no chunks are lost:
    1. Set is_recording=False and stop audio input.
    2. Join the recording worker (loop exits, no more jobs submitted).
    3. Drain the transcription executor (wait for in-flight Whisper jobs to
       finish and send their chunks) — this is the key step that prevents the
       race where the final chunk arrives after process_transcription.
    4. Transcribe any audio still in the buffer after the executor drains.
    5. Only then emit process_transcription.
    """
    global recorder, recording_thread, is_recording, _audio_buffer, _transcription_executor

    if not is_recording:
        return

    is_recording = False

    if recorder:
        recorder.stop_recording()

    if recording_thread and recording_thread.is_alive():
        recording_thread.join(timeout=2.0)

    # Drain executor: wait for every in-flight transcription job to complete
    # (and send its chunk) before we proceed.  Then recreate for next session.
    if _transcription_executor:
        _transcription_executor.shutdown(wait=True)
        _transcription_executor = ThreadPoolExecutor(
            max_workers=2,
            thread_name_prefix="transcribe",
        )

    # Safely grab remaining buffer
    buffer_copy = []
    with _audio_buffer_lock:
        if _audio_buffer:
            buffer_copy = list(_audio_buffer)
        _audio_buffer = []

    # Transcribe any audio that hadn't reached the min-duration threshold
    if buffer_copy and transcriber:
        try:
            accumulated_audio = np.concatenate(buffer_copy)
            min_samples = int(SAMPLE_RATE * 0.5)
            if len(accumulated_audio) >= min_samples:
                text = transcriber.transcribe_chunk(accumulated_audio, SAMPLE_RATE)
                if text and text.strip():
                    logger.info(f"🎤 Final Transcription: {text}")
                    print(f"🎤 Final Transcription: {text}")

                    if socket_client and socket_client.is_connected():
                        # send_transcription_chunk is synchronous — no sleep needed
                        socket_client.send_transcription_chunk(text)

                    if text and text.strip():
                        telemetry.log('transcription', text=text.strip())
        except Exception as e:
            logger.error(f"Error processing final accumulated audio: {e}")

    # Trigger server-side AI processing
    if socket_client and socket_client.is_connected():
        socket_client.process_transcription()
        logger.info("Sent process_transcription event")

    logger.info("Recording stopped")



# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.post("/start-recording", response_model=StartRecordingResponse)
async def start_recording():
    if is_recording:
        raise HTTPException(status_code=400, detail="Recording is already in progress")
    try:
        start_recording_internal(enable_realtime_chunks=True)
        return StartRecordingResponse(status="success", message="Recording started successfully")
    except Exception as e:
        logger.error(f"Failed to start recording: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start recording: {str(e)}")


@app.post("/stop-recording", response_model=StopRecordingResponse)
async def stop_recording():
    """Return immediately so the Node server can unblock the HUD state instantly.
    The heavy work (executor drain, final Whisper call, process_transcription)
    runs in a thread so it never blocks the event loop."""
    if not is_recording:
        return StopRecordingResponse(status="success", message="Not recording")
    try:
        # Run the blocking sync work in a thread — don't block the event loop.
        # The total time to AI answer is unchanged; only listen_state_changed
        # fires immediately instead of after all Whisper processing finishes.
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, stop_recording_internal_sync)
        return StopRecordingResponse(status="success", message="Recording stopped successfully")
    except Exception as e:
        logger.error(f"Failed to stop recording: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop recording: {str(e)}")


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "recording": is_recording,
        "socket_connected": socket_client.is_connected() if socket_client else False,
        "always_on_active": (always_on_listener is not None
                             and always_on_listener._running
                             and not always_on_listener._paused),
    }


@app.post("/reload-telemetry")
async def reload_telemetry():
    """Re-read api-keys.json and reinitialize the OTel exporters.

    Called by the Node settings page after the user enables/changes telemetry
    so they don't have to restart the transcriber. Idempotent — safe to call
    when telemetry is already configured (tear-down + re-init).
    """
    import json as _json
    import pathlib as _pathlib
    try:
        cfg_path = _pathlib.Path(__file__).parent.parent / 'config' / 'api-keys.json'
        with cfg_path.open('r') as f:
            new_cfg = _json.load(f)
    except Exception as e:
        logger.error(f"reload-telemetry: could not read config: {e}")
        raise HTTPException(status_code=500, detail=f"Could not read config: {e}")

    try:
        telemetry.shutdown_telemetry()
        telemetry.init_telemetry(new_cfg)
        if telemetry.is_enabled():
            telemetry.start_system_metrics_sampler(interval_seconds=10.0)
        logger.info("Telemetry reloaded (enabled=%s)", telemetry.is_enabled())
        return {"success": True, "enabled": telemetry.is_enabled()}
    except Exception as e:
        logger.error(f"reload-telemetry failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/always-on-mode")
async def set_always_on_mode(body: dict):
    global always_on_listener
    enabled = body.get("enabled", True)
    if enabled:
        # Python threads cannot be restarted once stopped — recreate if needed.
        if always_on_listener is None or not always_on_listener._running:
            try:
                always_on_listener = AlwaysOnListener(transcriber, socket_client)
                telemetry.GAUGE_LISTENER_ACTIVE.set(0, telemetry.get_host_labels() or None)
            except Exception as e:
                logger.error(f"Failed to initialize always-on listener: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to initialize listener: {str(e)}")
        if not always_on_listener._running:
            try:
                always_on_listener.start()
                logger.info("Always-on listener started")
            except Exception as e:
                logger.error(f"Failed to start always-on listener: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to start listener: {str(e)}")
    else:
        if always_on_listener and always_on_listener._running:
            always_on_listener.stop()
            logger.info("Always-on listener stopped")
    return {"status": "ok", "enabled": enabled}


@app.post("/set-stt-model")
async def set_stt_model(body: dict):
    global transcriber, always_on_listener
    model = body.get("model", "small")

    valid_models = {"tiny", "base", "small", "medium", "large", "whisper-1"}
    if model not in valid_models:
        raise HTTPException(status_code=400, detail=f"Invalid model. Must be one of: {', '.join(sorted(valid_models))}")

    logger.info(f"Switching STT model to: {model}")

    # Pause always-on listener while we swap the transcriber
    listener_was_running = False
    if always_on_listener and always_on_listener._running and not always_on_listener._paused:
        always_on_listener.pause()
        listener_was_running = True

    try:
        transcriber = Transcriber(model_size=model)
        logger.info(f"STT model switched to: {model}")
        log_writer.log('stt_model_switched', model=model)
    except Exception as e:
        logger.error(f"Failed to switch STT model: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")

    # Resume or recreate the always-on listener with the new transcriber
    if always_on_listener:
        always_on_listener._transcriber = transcriber
        if listener_was_running:
            always_on_listener.resume()
    elif listener_was_running:
        always_on_listener = AlwaysOnListener(transcriber, socket_client)
        always_on_listener.start()

    return {"status": "ok", "model": model}


@app.post("/set-vad-config")
async def set_vad_config(body: dict):
    global always_on_listener, transcriber
    if not body:
        raise HTTPException(status_code=400, detail="Empty config body")

    # Handle engine switch
    new_engine = body.get('engine')
    if new_engine and transcriber and transcriber.vad.engine_name != new_engine:
        from vad import create_vad
        old_engine = transcriber.vad.engine_name
        # Pause listener during swap
        if always_on_listener:
            always_on_listener.pause()
        transcriber.vad = create_vad(new_engine, body)
        if always_on_listener:
            always_on_listener.resume()
        logger.info(f"VAD engine switched: {old_engine} -> {new_engine}")
        log_writer.log('vad_engine_switched', from_engine=old_engine, to_engine=new_engine, config=body)

    # Update the always-on listener (which also updates the transcriber's VAD params)
    if always_on_listener:
        always_on_listener.update_config(body)
    elif transcriber:
        # If listener isn't running, still update the transcriber's VAD params directly
        transcriber.vad.update_config(body)

    logger.info(f"VAD config updated: {body}")
    log_writer.log('vad_config_updated', config=body)
    return {"status": "ok", "engine": transcriber.vad.engine_name if transcriber else None, "config": body}


@app.get("/vad-metrics")
async def get_vad_metrics():
    """Return rolling VAD metrics summary (5-minute window)."""
    if always_on_listener:
        return always_on_listener.metrics.get_summary()
    return {"error": "Always-on listener not running"}


@app.get("/settings")
async def get_settings():
    return {
        "stt_model": transcriber.model_size if transcriber else "small",
    }


@app.post("/load-speaker-id")
async def load_speaker_id_endpoint(body: dict):
    """Dynamically load (or reload) the speaker ID model (SpeechBrain ECAPA-TDNN).

    No HF token required — the body is accepted only for backwards compatibility
    with the old settings UI; only `threshold` is honored.
    Downloads the model on first run (~22 MB), cached thereafter.
    """
    global speaker_identifier, always_on_listener

    threshold = float(body.get("threshold") or SPEAKER_ID_THRESHOLD)

    logger.info("Loading speaker ID model on-demand (ECAPA-TDNN)...")
    log_writer.log('speaker_id_load_requested')

    try:
        new_identifier = SpeakerIdentifier(threshold=threshold)

        # First-run download can take a few seconds — run in thread so we don't block.
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, new_identifier.load_model)

        if not new_identifier.is_model_loaded:
            raise HTTPException(
                status_code=500,
                detail="Model failed to load — check transcriber logs for SpeechBrain errors"
            )

        # Swap in the new identifier globally
        speaker_identifier = new_identifier
        if always_on_listener is not None:
            always_on_listener._speaker_id = speaker_identifier

        logger.info("Speaker ID model loaded dynamically (enrolled=%s, device=%s)",
                    speaker_identifier.has_enrollment, speaker_identifier.device)
        log_writer.log('speaker_id_loaded_dynamic', enrolled=speaker_identifier.has_enrollment)

        return {
            "success":      True,
            "model_loaded": True,
            "enrolled":     speaker_identifier.has_enrollment,
            "threshold":    speaker_identifier.threshold,
            "device":       speaker_identifier.device,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Dynamic speaker ID load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/enroll-voice")
async def enroll_voice():
    """Record 30 seconds of mic audio and save the candidate's voice embedding."""
    global speaker_identifier, always_on_listener
    if speaker_identifier is None:
        raise HTTPException(status_code=503, detail="Speaker identification not available — enable it in config")
    if not speaker_identifier.is_model_loaded:
        raise HTTPException(status_code=503, detail="Speaker ID model not loaded — check transcriber logs for SpeechBrain errors")

    import sounddevice as sd

    ENROLL_SECONDS = 30

    # Pause the always-on listener so it releases the mic before we call sd.rec().
    # Without this, PortAudio raises err=-50 (device already in use) and returns
    # an empty buffer immediately — producing a garbage embedding in ~1 second.
    listener_was_running = (
        always_on_listener is not None
        and always_on_listener._running
        and not always_on_listener._paused
    )
    if listener_was_running:
        logger.info("Pausing always-on listener to free mic for enrollment...")
        always_on_listener.pause()

    logger.info(f"Starting voice enrollment — recording {ENROLL_SECONDS}s from mic...")
    log_writer.log('voice_enrollment_started', seconds=ENROLL_SECONDS)

    try:
        # Run blocking sd.rec + sd.wait in a thread so we don't block the event loop
        def _record():
            audio = sd.rec(
                int(ENROLL_SECONDS * SAMPLE_RATE),
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype='float32',
            )
            sd.wait()
            return audio.flatten()

        loop = asyncio.get_event_loop()
        audio_flat = await loop.run_in_executor(None, _record)

        success = speaker_identifier.enroll_from_audio(audio_flat, SAMPLE_RATE)
        if success:
            logger.info("Voice enrollment completed successfully")
            log_writer.log('voice_enrolled', success=True)
            return {"status": "ok", "enrolled": True}
        else:
            raise HTTPException(status_code=500, detail="Enrollment computation failed — see logs")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Enrollment error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Always resume the listener, even if enrollment failed
        if listener_was_running and always_on_listener is not None:
            logger.info("Resuming always-on listener after enrollment")
            always_on_listener.resume()


@app.get("/enrollment-status")
async def get_enrollment_status():
    """Return current speaker ID model and enrollment status."""
    if speaker_identifier is None:
        return {
            "model_loaded": False,
            "enrolled": False,
            "threshold": None,
            "reason": "Speaker ID disabled or model failed to load",
        }
    return {
        "model_loaded": speaker_identifier.is_model_loaded,
        "enrolled":     speaker_identifier.has_enrollment,
        "threshold":    speaker_identifier.threshold,
        "device":       speaker_identifier.device,
    }


# ── Whisper model management (local CPU backend) ──────────────────────────────

@app.get("/whisper-models")
async def list_whisper_models():
    """Return download status for each openai-whisper model on this machine."""
    import platform as _platform
    import pathlib

    model_sizes = {
        "tiny":   "~75 MB",
        "base":   "~145 MB",
        "small":  "~465 MB",
        "medium": "~1.5 GB",
        "large":  "~2.9 GB",
    }

    if _platform.system() == "Windows":
        cache_dir = pathlib.Path.home() / ".cache" / "whisper"
    else:
        cache_dir = pathlib.Path.home() / ".cache" / "whisper"

    models = []
    for name, size in model_sizes.items():
        # openai-whisper downloads files named e.g. "small.pt"
        downloaded = (cache_dir / f"{name}.pt").exists()
        models.append({"name": name, "downloaded": downloaded, "sizeLabel": size})

    return {"models": models, "cache_dir": str(cache_dir)}


@app.post("/download-whisper-model")
async def download_whisper_model(body: dict):
    """Download an openai-whisper model in the background."""
    model = (body or {}).get("model", "")
    valid = {"tiny", "base", "small", "medium", "large"}
    if model not in valid:
        raise HTTPException(status_code=400, detail=f"model must be one of {sorted(valid)}")

    def _do_download():
        try:
            import whisper as _w
            logger.info("Downloading openai-whisper model: %s", model)
            _w.load_model(model)
            logger.info("openai-whisper model downloaded: %s", model)
        except Exception as e:
            logger.error("Failed to download whisper model %s: %s", model, e)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _do_download)
    return {"status": "downloading", "model": model, "message": f"Downloading {model} in background — check transcriber.log"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=API_HOST, port=API_PORT)
