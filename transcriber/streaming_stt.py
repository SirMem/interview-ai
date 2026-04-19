"""
StreamingSTT — rolling-buffer streaming decoder on top of MLX Whisper.

Decodes every 300ms while the speaker is still talking, applies
LocalAgreement-2 to produce stable committed words, and emits a final
transcript 1s after VAD reports silence.

Pre-STT diarization hold/discard API:
  begin_utterance(uid)  — called at VAD speech-start; tags the current utterance
  hold_final(uid)       — called before handing off to SpeakerIDWorker; if _step()
                          fires on_final while hold is active it stores the result
  release_held(uid)     — called by SpeakerIDWorker on pass decision; emits stored
                          result immediately, or clears hold so next on_final fires
  discard(uid)          — called by SpeakerIDWorker on candidate decision; drops any
                          stored result and resets the buffer

Thread model:
  - feed() and set_vad_silent() are called from the sounddevice audio
    callback thread. They must be O(1) — only deque append + flag flip.
  - _decode_loop() runs on its own daemon thread. It holds _mlx_lock
    (the module-level lock in transcriber.py) for ~200-400ms per decode.
  - on_partial and on_final callbacks fire from the decode thread, so
    callers must not do heavy work inside them (queue to another thread
    or just do a fast socket.emit).
  - hold/discard methods are called from the SpeakerIDWorker thread.
    All hold-related state is protected by _held_lock.
"""
import threading
import time
import logging
from typing import Optional
import numpy as np
from collections import deque
from config import SAMPLE_RATE

logger = logging.getLogger(__name__)

# ── Tunable constants ─────────────────────────────────────────────────────────

DECODE_INTERVAL_S = 0.30    # re-decode every 300ms
BUFFER_MAX_S      = 15.0    # hard cap: drop oldest audio beyond this
COMMIT_TS_TOL_S   = 0.30    # LocalAgreement-2 timestamp tolerance
SILENCE_FINAL_S   = 1.00    # emit stt_final after this many seconds of VAD silence
MIN_BUFFER_S      = 1.0     # don't attempt decode until ≥1s of audio buffered
RMS_GATE          = 10 ** (-40 / 20)   # -40 dBFS — skip near-silent frames


class StreamingSTT:
    """Rolling-buffer streaming decoder with LocalAgreement-2 stabilisation."""

    def __init__(self, transcriber, on_partial, on_final):
        """
        Args:
            transcriber: existing Transcriber instance — used for model_path
                         and the module-level _mlx_lock.
            on_partial:  callback(committed: str, tentative: str)
            on_final:    callback(text: str, audio: np.ndarray, utterance_id: Optional[str])
        """
        self._transcriber = transcriber
        self.on_partial   = on_partial
        self.on_final     = on_final

        # Rolling audio buffer — protected by _lock
        self._lock        = threading.Lock()
        self._buffer      = deque()
        self._buf_samples = 0
        self._buf_start_t = 0.0

        # LocalAgreement-2 state
        self._committed   = []
        self._prev_decode = []

        # VAD silence tracking
        self._vad_silent   = False
        self._silent_since = None

        # Generation counter — incremented on _reset() to detect mid-decode resets
        self._generation = 0

        # ── Hold / discard state (pre-STT diarization) ────────────────────────
        # Protected by _held_lock (separate from _lock to avoid contention)
        self._held_lock           = threading.Lock()
        self._current_utterance_id: Optional[str] = None
        self._pending_hold:  set  = set()          # UIDs waiting for speaker ID
        self._held_results:  dict = {}             # uid → (text, audio_snapshot)
        self._discarded_set: set  = set()          # UIDs that should be dropped

        # Lifecycle
        self._running = False
        self._thread  = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        if self._running:
            return
        self._running     = True
        self._buf_start_t = time.time()
        self._thread = threading.Thread(
            target=self._decode_loop, daemon=True, name="streaming-stt"
        )
        self._thread.start()
        logger.info("StreamingSTT started (decode every %.0fms)", DECODE_INTERVAL_S * 1000)

    def stop(self):
        self._running = False
        logger.info("StreamingSTT stopped")

    def force_final(self):
        """Emit stt_final immediately with whatever is in the buffer.
        Called when the user explicitly stops the listener (Cmd+Shift+X off).
        Does nothing if the buffer is empty.
        """
        with self._lock:
            if not self._committed and not self._prev_decode:
                return

            committed_str = ' '.join(w for w, _, _ in self._committed)
            committed_set = {(w, round(s, 2)) for w, s, _ in self._committed}
            tentative_str = ' '.join(
                w for w, s, _ in self._prev_decode
                if (w, round(s, 2)) not in committed_set
            )
            full = committed_str
            if tentative_str:
                full = (full + ' ' + tentative_str).strip()

        if full:
            logger.info("StreamingSTT force_final: %s", full[:80])
            self._reset()
            self.on_final(full, np.array([], dtype=np.float32), None)

    # ── Pre-STT diarization API ───────────────────────────────────────────────

    def begin_utterance(self, utterance_id: str):
        """Tag the start of a new utterance. Called at VAD speech-start."""
        with self._held_lock:
            self._current_utterance_id = utterance_id

    def hold_final(self, utterance_id: str):
        """Mark utterance as held: on_final will store result instead of emitting.
        Called just before the VAD segment is submitted to SpeakerIDWorker.
        """
        with self._held_lock:
            self._pending_hold.add(utterance_id)

    def release_held(self, utterance_id: str):
        """SpeakerIDWorker decided: pass. Remove hold and emit if result is ready."""
        with self._held_lock:
            self._pending_hold.discard(utterance_id)
            result = self._held_results.pop(utterance_id, None)

        if result is not None:
            text, audio = result
            logger.debug("StreamingSTT: releasing held result uid=%.8s", utterance_id)
            self.on_final(text, audio, utterance_id)

    def discard(self, utterance_id: str):
        """SpeakerIDWorker decided: candidate. Drop any stored result and reset."""
        with self._held_lock:
            self._discarded_set.add(utterance_id)
            self._pending_hold.discard(utterance_id)
            self._held_results.pop(utterance_id, None)
        logger.debug("StreamingSTT: discarding uid=%.8s (candidate voice)", utterance_id)
        self._reset()
        # Clear the HUD live strip — candidate speech should not show
        self.on_partial('', '')

    # ── Audio callback interface (must be O(1)) ───────────────────────────────

    def feed(self, chunk: np.ndarray):
        with self._lock:
            self._buffer.append(chunk.copy())
            self._buf_samples += len(chunk)
            while self._buf_samples > int(BUFFER_MAX_S * SAMPLE_RATE) and self._buffer:
                dropped            = self._buffer.popleft()
                self._buf_samples -= len(dropped)
                self._buf_start_t += len(dropped) / SAMPLE_RATE

    def set_vad_silent(self, is_silent: bool):
        with self._lock:
            if is_silent and not self._vad_silent:
                self._silent_since = time.time()
            elif not is_silent:
                self._silent_since = None
            self._vad_silent = is_silent

    # ── Background decode loop ────────────────────────────────────────────────

    def _decode_loop(self):
        while self._running:
            time.sleep(DECODE_INTERVAL_S)
            try:
                self._step()
            except Exception as e:
                logger.error("StreamingSTT decode error: %s", e, exc_info=True)

    def _step(self):
        # Snapshot utterance_id first (under held_lock — fast)
        with self._held_lock:
            utterance_id = self._current_utterance_id

        # Snapshot audio state (under _lock — fast)
        with self._lock:
            if self._buf_samples < int(MIN_BUFFER_S * SAMPLE_RATE):
                return

            audio        = np.concatenate(list(self._buffer))
            buf_start    = self._buf_start_t
            silent_since = self._silent_since
            generation   = self._generation

        # RMS energy gate
        rms = float(np.sqrt(np.mean(audio ** 2)))
        if rms < RMS_GATE:
            return

        # Run Whisper — holds _mlx_lock for ~200-400ms
        words = self._decode_with_timestamps(audio, buf_start)

        # Update committed prefix (under _lock)
        with self._lock:
            if self._generation != generation:
                return   # _reset() ran mid-decode — discard

            self._committed   = self._local_agreement_2(words, self._prev_decode, self._committed)
            self._prev_decode = words

            committed_str = ' '.join(w for w, _, _ in self._committed)
            committed_set = {(w, round(s, 2)) for w, s, _ in self._committed}
            tentative_str = ' '.join(
                w for w, s, _ in words
                if (w, round(s, 2)) not in committed_set
            )

            if self._committed:
                self._prune_buffer(self._committed[-1][2] - 0.5)

        if committed_str or tentative_str:
            self.on_partial(committed_str, tentative_str)

        # Final condition: VAD silent for ≥ SILENCE_FINAL_S
        if silent_since is not None and (time.time() - silent_since) >= SILENCE_FINAL_S:
            full = committed_str
            if tentative_str:
                full = (full + ' ' + tentative_str).strip()
            audio_snapshot = audio.copy()

            # Check hold / discard state before emitting
            with self._held_lock:
                if utterance_id and utterance_id in self._discarded_set:
                    # Already marked for discard — drop and clean up
                    self._discarded_set.discard(utterance_id)
                    return
                if utterance_id and utterance_id in self._pending_hold:
                    # Speaker ID hasn't decided yet — store result
                    if full:
                        self._held_results[utterance_id] = (full, audio_snapshot)
                    return
                # No hold active — proceed normally

            self._reset()
            if full:
                self.on_final(full, audio_snapshot, utterance_id)

    # ── Whisper call ─────────────────────────────────────────────────────────

    def _decode_with_timestamps(self, audio: np.ndarray, buf_start: float):
        backend = getattr(self._transcriber, 'backend', 'mlx')
        if backend == 'mlx':
            return self._decode_mlx(audio, buf_start)
        elif backend == 'local':
            return self._decode_local_cpu(audio, buf_start)
        else:
            # API backend: no word timestamps — split text into fake-timestamped words
            return self._decode_api_fallback(audio, buf_start)

    def _decode_mlx(self, audio: np.ndarray, buf_start: float):
        from mlx_whisper import transcribe
        from transcriber import _mlx_lock

        with _mlx_lock:
            result = transcribe(
                audio,
                path_or_hf_repo=self._transcriber.model_path,
                word_timestamps=True,
                condition_on_previous_text=False,
                language='en',
                verbose=False,
                no_speech_threshold=0.6,
            )

        words = []
        for seg in (result.get('segments') or []):
            for w in (seg.get('words') or []):
                word = (w.get('word') or '').strip()
                if word:
                    words.append((word, buf_start + w.get('start', 0), buf_start + w.get('end', 0)))
        return words

    def _decode_local_cpu(self, audio: np.ndarray, buf_start: float):
        from transcriber import _mlx_lock

        with _mlx_lock:
            result = self._transcriber._local_model.transcribe(
                audio,
                word_timestamps=True,
                condition_on_previous_text=False,
                language='en',
                verbose=False,
                no_speech_threshold=0.6,
                fp16=False,
            )

        words = []
        for seg in (result.get('segments') or []):
            for w in (seg.get('words') or []):
                word = (w.get('word') or '').strip()
                if word:
                    words.append((word, buf_start + w.get('start', 0), buf_start + w.get('end', 0)))
        return words

    def _decode_api_fallback(self, audio: np.ndarray, buf_start: float):
        text = self._transcriber.transcribe_audio(audio, 16000)
        if not text:
            return []
        # No real timestamps from API — use 0 so LocalAgreement-2 falls back to text-only matching
        word_list = text.split()
        return [(w, 0.0, 0.0) for w in word_list]

    # ── LocalAgreement-2 ─────────────────────────────────────────────────────

    def _local_agreement_2(self, current, previous, existing_committed):
        committed = list(existing_committed)
        start_i   = len(committed)

        for i, (word, start, _) in enumerate(current[start_i:], start=start_i):
            if i >= len(previous):
                break
            prev_word, prev_start, _ = previous[i]

            text_match = (word == prev_word)
            if start > 0 and prev_start > 0:
                ts_match = abs(start - prev_start) <= COMMIT_TS_TOL_S
            else:
                ts_match = True

            if text_match and ts_match:
                committed.append((word, start, _))
            else:
                break

        return committed

    # ── Buffer maintenance ────────────────────────────────────────────────────

    def _prune_buffer(self, prune_before: float):
        t = self._buf_start_t
        while self._buffer:
            chunk     = self._buffer[0]
            chunk_end = t + len(chunk) / SAMPLE_RATE
            if chunk_end < prune_before:
                self._buffer.popleft()
                self._buf_samples -= len(chunk)
                self._buf_start_t  = chunk_end
                t = chunk_end
            else:
                break

    def _reset(self):
        """Reset all state after emitting a final or discarding an utterance."""
        with self._lock:
            self._generation  += 1
            self._buffer.clear()
            self._buf_samples  = 0
            self._buf_start_t  = time.time()
            self._committed    = []
            self._prev_decode  = []
            self._silent_since = None
            self._vad_silent   = False
