"""
Always-on microphone listener for continuous interviewer speech detection.

Runs a separate audio stream (100ms chunks) with a VAD state machine.
When silence follows a speech segment, the accumulated audio is transcribed
and sent to the Node server as an 'interviewer_speech' event.

Usage: instantiate with a Transcriber and SocketClient, then call start().
"""
import logging
import random
import threading
import time
from collections import deque
import numpy as np
import sounddevice as sd
from concurrent.futures import ThreadPoolExecutor

from config import (
    SAMPLE_RATE,
    ALWAYS_ON_SILENCE_THRESHOLD,
    ALWAYS_ON_MIN_SPEECH_DURATION,
    ALWAYS_ON_MAX_UTTERANCE_DURATION,
    VAD_MIN_WORD_COUNT,
)
from vad.metrics import VADMetrics
import log_writer

logger = logging.getLogger(__name__)

# 100ms micro-chunks for responsive VAD
_BLOCK_DURATION = 0.1
_BLOCK_SIZE = int(SAMPLE_RATE * _BLOCK_DURATION)

# Log sampling rate for per-chunk metrics (10% → ~1 log per second of audio)
_CHUNK_LOG_SAMPLE_RATE = 0.1


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
        self._probability_buffer = []    # per-chunk speech probabilities
        self._speech_samples = 0         # total samples accumulated
        self._silent_frames = 0          # consecutive silent 100ms frames
        self._force_flushed = False      # whether max duration triggered flush

        # Min word count for post-transcription filtering
        self._min_word_count = VAD_MIN_WORD_COUNT

        # Derived thresholds
        self._silence_frames_threshold = int(ALWAYS_ON_SILENCE_THRESHOLD / _BLOCK_DURATION)
        self._min_speech_samples = int(ALWAYS_ON_MIN_SPEECH_DURATION * SAMPLE_RATE)
        self._max_speech_samples = int(ALWAYS_ON_MAX_UTTERANCE_DURATION * SAMPLE_RATE)

        # Rolling probability window for smoothing (5 chunks = 500ms)
        self._prob_window_size = 5
        self._prob_window: deque = deque(maxlen=self._prob_window_size)

        # Metrics
        self.metrics = VADMetrics()

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
        log_writer.log('always_on_started',
                       silence_threshold=ALWAYS_ON_SILENCE_THRESHOLD,
                       min_speech=ALWAYS_ON_MIN_SPEECH_DURATION,
                       max_utterance=ALWAYS_ON_MAX_UTTERANCE_DURATION,
                       min_word_count=self._min_word_count)

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

    def update_config(self, config: dict):
        """Update VAD thresholds at runtime from a config dict."""
        # Delegate engine-specific params to the VAD instance
        self._transcriber.vad.update_config(config)
        if 'silence_threshold' in config:
            self._silence_frames_threshold = int(float(config['silence_threshold']) / _BLOCK_DURATION)
        if 'min_speech_duration' in config:
            self._min_speech_samples = int(float(config['min_speech_duration']) * SAMPLE_RATE)
        if 'max_utterance_duration' in config:
            self._max_speech_samples = int(float(config['max_utterance_duration']) * SAMPLE_RATE)
        if 'min_word_count' in config:
            self._min_word_count = int(config['min_word_count'])
        logger.info(f"VAD config updated: {config}")
        log_writer.log('vad_config_applied', config=config)

    # ------------------------------------------------------------------
    # Audio callback (runs in audio thread — must be fast)
    # ------------------------------------------------------------------

    def _audio_callback(self, indata, frames, time_info, status):
        if not self._running or self._paused:
            return

        chunk = indata[:, 0].copy()  # mono, float32

        # Measure VAD latency
        vad = self._transcriber.vad
        t0 = time.perf_counter()
        prob = vad.speech_probability(chunk, SAMPLE_RATE)
        latency_ms = (time.perf_counter() - t0) * 1000

        # Smoothing: for Silero, use rolling average to reduce single-frame false triggers
        if vad.engine_name == 'silero':
            self._prob_window.append(prob)
            smoothed_prob = sum(self._prob_window) / len(self._prob_window)
            is_speech = smoothed_prob >= self._get_threshold()
        else:
            is_speech = prob >= self._get_threshold()

        rms_energy = float(np.sqrt(np.mean(chunk ** 2)))

        # Record metrics
        record = self.metrics.record_chunk(
            engine=vad.engine_name,
            rms_energy=rms_energy,
            energy_gate_passed=(prob > 0.0),
            speech_probability=prob,
            is_speech=is_speech,
            latency_ms=latency_ms,
        )

        # Sampled logging (10% of chunks → ~1/s)
        if random.random() < _CHUNK_LOG_SAMPLE_RATE:
            log_writer.log('vad_chunk', **record)

        if is_speech:
            self._state = 'speech'
            self._silent_frames = 0
            self._speech_buffer.append(chunk)
            self._probability_buffer.append(prob)
            self._speech_samples += len(chunk)

            # Force-flush if utterance is too long
            if self._speech_samples >= self._max_speech_samples:
                self._force_flushed = True
                self._flush_utterance()
        else:
            if self._state == 'speech':
                self._silent_frames += 1
                # Keep accumulating audio during silence (for trailing words)
                self._speech_buffer.append(chunk)
                self._probability_buffer.append(prob)
                self._speech_samples += len(chunk)

                if self._silent_frames >= self._silence_frames_threshold:
                    self._flush_utterance()
            # If already in silence state, do nothing

    def _get_threshold(self) -> float:
        """Get the speech threshold for the current engine."""
        vad = self._transcriber.vad
        if vad.engine_name == 'silero':
            return getattr(vad, '_threshold', 0.5)
        else:
            return getattr(vad, '_speech_frame_ratio', 0.7)

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
        probs = list(self._probability_buffer)
        silent_frames = self._silent_frames
        force_flushed = self._force_flushed
        chunk_count = len(probs)
        duration_s = self._speech_samples / SAMPLE_RATE
        self._reset_vad()

        # Transcribe in thread pool (MLX is slow, don't block audio callback)
        self._executor.submit(
            self._transcribe_and_emit,
            audio, probs, chunk_count, duration_s, silent_frames, force_flushed,
        )

    def _reset_vad(self):
        self._state = 'silence'
        self._speech_buffer = []
        self._probability_buffer = []
        self._speech_samples = 0
        self._silent_frames = 0
        self._force_flushed = False
        self._prob_window.clear()
        # Reset VAD internal state (important for Silero's RNN)
        self._transcriber.vad.reset_state()

    # Known Whisper hallucinations on silence/noise
    _HALLUCINATIONS = {
        "you", "yeah", "hmm", "uh", "um", "hm", "oh", "ah", "okay", "ok", "bye",
        "thank you", "thanks", "thank you for watching", "thanks for watching",
        "thank you for listening", "thanks for listening",
        "please subscribe", "like and subscribe",
        "subtitles by", "subtitles made by",
        "the end", "the end.", "...",
        "so", "and", "but", "right", "yes", "no", "hey", "hi", "hello",
        "good", "good bye", "goodbye", "see you", "see you next time",
    }

    @staticmethod
    def _is_gibberish(text: str) -> bool:
        """Detect repetitive/gibberish output that Whisper produces on noise."""
        words = text.strip().split()
        if len(words) < 4:
            return False
        # Check if the same word repeats too much (e.g., "the the the the")
        from collections import Counter
        counts = Counter(w.lower() for w in words)
        most_common_count = counts.most_common(1)[0][1]
        if most_common_count / len(words) >= 0.6:
            return True
        # Check for repeated phrases (e.g., "thank you thank you thank you")
        bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]
        if bigrams:
            bigram_counts = Counter(bigrams)
            if bigram_counts.most_common(1)[0][1] >= 3:
                return True
        return False

    def _transcribe_and_emit(self, audio: np.ndarray, probs: list,
                              chunk_count: int, duration_s: float,
                              silent_frames: int, force_flushed: bool):
        try:
            text = self._transcriber.transcribe_chunk(audio, SAMPLE_RATE)

            # Determine filter outcome
            was_filtered = False
            filter_reason = None

            if not text or not text.strip():
                was_filtered = True
                filter_reason = 'empty'
            else:
                words = text.strip().split()
                if len(words) < self._min_word_count:
                    was_filtered = True
                    filter_reason = 'too_short'
                    logger.debug(f"Skipping short/hallucinated output: {text!r}")
                elif text.strip().lower().rstrip('.!?,') in self._HALLUCINATIONS:
                    was_filtered = True
                    filter_reason = 'hallucination'
                    logger.debug(f"Skipping hallucination: {text!r}")
                elif self._is_gibberish(text):
                    was_filtered = True
                    filter_reason = 'gibberish'
                    logger.debug(f"Skipping gibberish/repetitive output: {text!r}")

            # Compute probability stats
            speech_probs = [p for p in probs if p > 0]
            avg_prob = sum(speech_probs) / len(speech_probs) if speech_probs else 0.0
            min_prob = min(speech_probs) if speech_probs else 0.0
            max_prob = max(speech_probs) if speech_probs else 0.0

            # Record utterance metrics
            engine = self._transcriber.vad.engine_name
            utterance_record = self.metrics.record_utterance(
                engine=engine,
                utterance_duration_s=duration_s,
                chunk_count=chunk_count,
                avg_speech_probability=avg_prob,
                min_speech_probability=min_prob,
                max_speech_probability=max_prob,
                silent_frames_at_end=silent_frames,
                force_flushed=force_flushed,
                transcription_result=text or '',
                was_filtered=was_filtered,
                filter_reason=filter_reason,
            )

            # Log every utterance (these are infrequent and high-value)
            log_writer.log('vad_utterance', **utterance_record)

            if was_filtered:
                return

            logger.info(f"Interviewer: {text}")
            print(f"Interviewer: {text}")
            log_writer.log('interviewer_speech', text=text, engine=engine,
                           avg_probability=round(avg_prob, 4),
                           duration_s=round(duration_s, 3))
            if self._socket_client and self._socket_client.is_connected():
                self._socket_client.send_interviewer_speech(text)
        except Exception as e:
            logger.error(f"AlwaysOnListener transcription error: {e}")
