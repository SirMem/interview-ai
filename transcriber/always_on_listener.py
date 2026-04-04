"""
Always-on microphone listener for continuous interviewer speech detection.

Runs a separate audio stream (100ms chunks) with a VAD state machine.
When silence follows a speech segment, the accumulated audio is transcribed
and sent to the Node server as an 'interviewer_speech' event.

Usage: instantiate with a Transcriber and SocketClient, then call start().
"""
import logging
import threading
import numpy as np
import sounddevice as sd
from concurrent.futures import ThreadPoolExecutor

from config import (
    SAMPLE_RATE,
    ALWAYS_ON_SILENCE_THRESHOLD,
    ALWAYS_ON_MIN_SPEECH_DURATION,
    ALWAYS_ON_MAX_UTTERANCE_DURATION,
)

logger = logging.getLogger(__name__)

# 100ms micro-chunks for responsive VAD
_BLOCK_DURATION = 0.1
_BLOCK_SIZE = int(SAMPLE_RATE * _BLOCK_DURATION)


class AlwaysOnListener:
    """Continuously listens to the microphone and emits detected utterances."""

    def __init__(self, transcriber, socket_client):
        self._transcriber = transcriber
        self._socket_client = socket_client

        self._paused = False
        self._running = False
        self._stream = None
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aol-transcribe")

        # VAD state
        self._state = 'silence'          # 'silence' | 'speech'
        self._speech_buffer = []         # list of np.ndarray chunks
        self._speech_samples = 0         # total samples accumulated
        self._silent_frames = 0          # consecutive silent 100ms frames

        # Derived thresholds
        self._silence_frames_threshold = int(ALWAYS_ON_SILENCE_THRESHOLD / _BLOCK_DURATION)
        self._min_speech_samples = int(ALWAYS_ON_MIN_SPEECH_DURATION * SAMPLE_RATE)
        self._max_speech_samples = int(ALWAYS_ON_MAX_UTTERANCE_DURATION * SAMPLE_RATE)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        if self._running:
            return
        self._running = True
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=_BLOCK_SIZE,
            callback=self._audio_callback,
        )
        self._stream.start()
        logger.info(
            f"AlwaysOnListener started "
            f"(silence_threshold={ALWAYS_ON_SILENCE_THRESHOLD}s, "
            f"min_speech={ALWAYS_ON_MIN_SPEECH_DURATION}s)"
        )

    def stop(self):
        self._running = False
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as e:
                logger.warning(f"Error stopping always-on stream: {e}")
            self._stream = None
        self._executor.shutdown(wait=False)
        logger.info("AlwaysOnListener stopped")

    def pause(self):
        self._paused = True
        logger.info("AlwaysOnListener paused")

    def resume(self):
        self._paused = False
        logger.info("AlwaysOnListener resumed")

    # ------------------------------------------------------------------
    # Audio callback (runs in audio thread — must be fast)
    # ------------------------------------------------------------------

    def _audio_callback(self, indata, frames, time_info, status):
        if not self._running or self._paused:
            return

        chunk = indata[:, 0].copy()  # mono, float32

        is_speech = self._transcriber._has_voice_activity(chunk, SAMPLE_RATE)

        if is_speech:
            self._state = 'speech'
            self._silent_frames = 0
            self._speech_buffer.append(chunk)
            self._speech_samples += len(chunk)

            # Force-flush if utterance is too long
            if self._speech_samples >= self._max_speech_samples:
                self._flush_utterance()
        else:
            if self._state == 'speech':
                self._silent_frames += 1
                # Keep accumulating audio during silence (for trailing words)
                self._speech_buffer.append(chunk)
                self._speech_samples += len(chunk)

                if self._silent_frames >= self._silence_frames_threshold:
                    self._flush_utterance()
            # If already in silence state, do nothing

    # ------------------------------------------------------------------
    # Utterance flushing
    # ------------------------------------------------------------------

    def _flush_utterance(self):
        if not self._speech_buffer:
            self._reset_vad()
            return

        if self._speech_samples < self._min_speech_samples:
            # Too short — likely noise, discard
            self._reset_vad()
            return

        audio = np.concatenate(self._speech_buffer)
        self._reset_vad()

        # Transcribe in thread pool (MLX is slow, don't block audio callback)
        self._executor.submit(self._transcribe_and_emit, audio)

    def _reset_vad(self):
        self._state = 'silence'
        self._speech_buffer = []
        self._speech_samples = 0
        self._silent_frames = 0

    # Known Whisper hallucinations on silence/noise
    _HALLUCINATIONS = {"you", "yeah", "hmm", "uh", "um", "hm", "oh", "ah", "okay", "ok", "bye"}

    def _transcribe_and_emit(self, audio: np.ndarray):
        try:
            text = self._transcriber.transcribe_chunk(audio, SAMPLE_RATE)
            if not text or not text.strip():
                return
            # Drop single-word outputs and known hallucinations
            words = text.strip().split()
            if len(words) < 2:
                logger.debug(f"Skipping short/hallucinated output: {text!r}")
                return
            if text.strip().lower() in self._HALLUCINATIONS:
                logger.debug(f"Skipping hallucination: {text!r}")
                return
            logger.info(f"🎙️ Interviewer: {text}")
            print(f"🎙️ Interviewer: {text}")
            if self._socket_client and self._socket_client.is_connected():
                self._socket_client.send_interviewer_speech(text)
        except Exception as e:
            logger.error(f"AlwaysOnListener transcription error: {e}")
