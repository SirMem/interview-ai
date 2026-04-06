"""
FastAPI server for real-time speech-to-text transcription
"""
import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import numpy as np

from audio_recorder import AudioRecorder
from transcriber import Transcriber
from socket_client import SocketClient
from keyboard_handler import KeyboardHandler
from always_on_listener import AlwaysOnListener
import log_writer
from config import SAMPLE_RATE, API_HOST, API_PORT, LOG_LEVEL, TRANSCRIPTIONS_JSON_FILE, KEYBOARD_ENABLED, ALWAYS_ON_ENABLED

# Configure logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# NDJSON async writer (O(1) appends — no full-file reads)
# ---------------------------------------------------------------------------
_transcription_queue: deque = deque()
_json_writer_thread: Optional[threading.Thread] = None
_json_writer_running: bool = False
_json_writer_lock = threading.Lock()


def json_writer_worker():
    """Background thread that appends transcriptions to an NDJSON file.

    Each line in the file is a self-contained JSON object (newline-delimited
    JSON). This avoids reading + rewriting the whole file on every flush,
    keeping write cost O(1) regardless of history size.
    """
    global _transcription_queue, _json_writer_running

    while _json_writer_running:
        try:
            if not _transcription_queue:
                threading.Event().wait(0.1)
                continue

            batch = []
            while _transcription_queue:
                batch.append(_transcription_queue.popleft())

            if not batch:
                continue

            with _json_writer_lock:
                with open(TRANSCRIPTIONS_JSON_FILE, 'a', encoding='utf-8') as f:
                    for entry in batch:
                        f.write(json.dumps(entry, ensure_ascii=False) + '\n')

            logger.debug(f"Appended {len(batch)} transcription(s) to {TRANSCRIPTIONS_JSON_FILE}")

        except Exception as e:
            logger.error(f"Error in JSON writer worker: {e}")


def append_transcription_to_json(text: str):
    """Queue a transcription entry for async NDJSON file writing (non-blocking)."""
    if not text or not text.strip():
        return
    _transcription_queue.append({
        "text": text.strip(),
        "timestamp": datetime.now().isoformat(),
        "unix_timestamp": datetime.now().timestamp(),
    })


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global transcriber, socket_client, keyboard_handler, always_on_listener
    global _json_writer_thread, _json_writer_running, _transcription_executor

    logger.info("Initializing STT system components...")

    # Start the shared JSON log writer (writes to logs/app.jsonl)
    log_writer.start()

    try:
        transcriber = Transcriber()
        logger.info("Transcriber initialized")
        log_writer.log('transcriber_initialized', model=transcriber.model_size, use_api=transcriber.use_api)

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

        _json_writer_running = True
        _json_writer_thread = threading.Thread(target=json_writer_worker, daemon=True)
        _json_writer_thread.start()
        logger.info("JSON writer thread started (NDJSON mode)")

        if KEYBOARD_ENABLED:
            try:
                def start_recording_keyboard():
                    start_recording_internal(enable_realtime_chunks=True)

                keyboard_handler = KeyboardHandler(
                    on_key_press=start_recording_keyboard,
                    on_key_release=stop_recording_internal_sync,
                )
                keyboard_handler.start()
                logger.info("Keyboard handler started (real-time transcription mode)")
            except Exception as e:
                logger.warning(f"Could not start keyboard handler: {e}")
                keyboard_handler = None
        else:
            logger.info("Keyboard handler disabled in configuration")

        if ALWAYS_ON_ENABLED:
            try:
                always_on_listener = AlwaysOnListener(transcriber, socket_client)
                always_on_listener.start()
                logger.info("Always-on listener started (interviewer speech detection mode)")
            except Exception as e:
                logger.warning(f"Could not start always-on listener: {e}")
                always_on_listener = None
        else:
            logger.info("Always-on listener disabled (set ALWAYS_ON_ENABLED=true to enable)")

        logger.info("STT system ready")

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

    _json_writer_running = False
    if _json_writer_thread and _json_writer_thread.is_alive():
        _json_writer_thread.join(timeout=2.0)

    if socket_client:
        socket_client.disconnect()

    log_writer.log('transcriber_shutdown')
    log_writer.stop()
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

                append_transcription_to_json(text)

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

    The ``time.sleep()`` that previously preceded ``process_transcription``
    has been removed — ``socket_client.send_transcription_chunk()`` is
    synchronous (blocking until the message is sent), so no artificial delay
    is needed.
    """
    global recorder, recording_thread, is_recording, _audio_buffer

    if not is_recording:
        return

    is_recording = False

    if recorder:
        recorder.stop_recording()

    if recording_thread and recording_thread.is_alive():
        recording_thread.join(timeout=2.0)

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

                    append_transcription_to_json(text)
        except Exception as e:
            logger.error(f"Error processing final accumulated audio: {e}")

    # Trigger server-side AI processing
    if socket_client and socket_client.is_connected():
        socket_client.process_transcription()
        logger.info("Sent process_transcription event")

    logger.info("Recording stopped")


async def stop_recording_internal():
    stop_recording_internal_sync()


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
    try:
        await stop_recording_internal()
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
    }


@app.post("/always-on-mode")
async def set_always_on_mode(body: dict):
    global always_on_listener
    enabled = body.get("enabled", True)
    if enabled:
        if always_on_listener is None:
            try:
                always_on_listener = AlwaysOnListener(transcriber, socket_client)
                always_on_listener.start()
                logger.info("Always-on listener started on-demand")
            except Exception as e:
                logger.error(f"Failed to start always-on listener: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to start listener: {str(e)}")
        else:
            always_on_listener.resume()
    else:
        if always_on_listener:
            always_on_listener.pause()
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=API_HOST, port=API_PORT)
