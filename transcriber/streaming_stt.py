"""
StreamingSTT — rolling-buffer streaming decoder on top of MLX Whisper.

Decodes every 300ms while the speaker is still talking, applies
LocalAgreement-2 to produce stable committed words, and emits a final
transcript 700ms after VAD reports silence.

Thread model:
  - feed() and set_vad_silent() are called from the sounddevice audio
    callback thread. They must be O(1) — only deque append + flag flip.
  - _decode_loop() runs on its own daemon thread. It holds _mlx_lock
    (the module-level lock in transcriber.py) for ~200-400ms per decode.
  - on_partial and on_final callbacks fire from the decode thread, so
    callers must not do heavy work inside them (queue to another thread
    or just do a fast socket.emit).
"""
import threading
import time
import logging
import numpy as np
from collections import deque
from config import SAMPLE_RATE

logger = logging.getLogger(__name__)

# ── Tunable constants ─────────────────────────────────────────────────────────

DECODE_INTERVAL_S = 0.30    # re-decode every 300ms
BUFFER_MAX_S      = 15.0    # hard cap: drop oldest audio beyond this
COMMIT_TS_TOL_S   = 0.30    # LocalAgreement-2 timestamp tolerance (loose — tighten if false commits appear)
SILENCE_FINAL_S   = 1.00    # emit stt_final after this many seconds of VAD silence
MIN_BUFFER_S      = 1.0     # don't attempt decode until ≥1s of audio buffered
RMS_GATE          = 10 ** (-40 / 20)   # -40 dBFS — skip near-silent frames (hallucination prevention)


class StreamingSTT:
    """Rolling-buffer streaming decoder with LocalAgreement-2 stabilisation."""

    def __init__(self, transcriber, on_partial, on_final):
        """
        Args:
            transcriber: existing Transcriber instance — used for model_path
                         and the module-level _mlx_lock.
            on_partial:  callback(committed: str, tentative: str) — called
                         every decode step with the latest partial.
            on_final:    callback(text: str, audio: np.ndarray) — called once when
                         VAD silence ≥ SILENCE_FINAL_S. audio is the float32 buffer
                         of the full utterance (16000 Hz), used for speaker ID.
        """
        self._transcriber = transcriber
        self.on_partial   = on_partial
        self.on_final     = on_final

        # Rolling audio buffer — protected by _lock
        self._lock        = threading.Lock()
        self._buffer      = deque()       # deque of np.ndarray chunks (float32)
        self._buf_samples = 0
        self._buf_start_t = 0.0          # absolute time.time() of buffer[0]

        # LocalAgreement-2 state
        self._committed   = []           # list of (word, abs_start, abs_end) — never shrinks
        self._prev_decode = []           # output of previous decode, for LA-2 comparison

        # VAD silence tracking
        self._vad_silent   = False
        self._silent_since = None        # time.time() when silence began

        # Generation counter — incremented on every _reset(). Each _step() snapshots
        # this at the top and re-checks after the decode finishes. If the value changed,
        # force_final() (or any other reset) ran mid-decode, so we discard the result
        # to prevent a duplicate stt_final.
        self._generation = 0

        # Lifecycle
        self._running = False
        self._thread  = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        """Start the background decode loop."""
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
        """Signal the decode loop to exit. Does not join — daemon thread."""
        self._running = False
        logger.info("StreamingSTT stopped")

    def force_final(self):
        """Emit stt_final immediately with whatever is in the buffer.
        Called when the user explicitly stops the listener (Cmd+Shift+X off)
        so that a question spoken right before stopping still gets answered,
        even if the 700ms silence timer hasn't fired yet.
        Does nothing if the buffer is empty.
        """
        with self._lock:
            if not self._committed and not self._prev_decode:
                return   # nothing to emit

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
            # force_final has no live decode running, so no audio snapshot available
            self.on_final(full, np.array([], dtype=np.float32))

    # ── Audio callback interface (must be O(1)) ───────────────────────────────

    def feed(self, chunk: np.ndarray):
        """Append a 100ms audio chunk to the rolling buffer.
        Called from sounddevice's real-time callback — must be fast.
        """
        with self._lock:
            self._buffer.append(chunk.copy())
            self._buf_samples += len(chunk)
            # Hard cap: evict oldest chunks beyond BUFFER_MAX_S
            while self._buf_samples > int(BUFFER_MAX_S * SAMPLE_RATE) and self._buffer:
                dropped            = self._buffer.popleft()
                self._buf_samples -= len(dropped)
                self._buf_start_t += len(dropped) / SAMPLE_RATE

    def set_vad_silent(self, is_silent: bool):
        """Tell the decode loop whether VAD currently reports silence.
        Called from sounddevice's real-time callback — must be fast.
        """
        with self._lock:
            if is_silent and not self._vad_silent:
                self._silent_since = time.time()   # silence just started
            elif not is_silent:
                self._silent_since = None          # speech resumed
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
        # Snapshot state under lock — release before calling Whisper (slow)
        with self._lock:
            if self._buf_samples < int(MIN_BUFFER_S * SAMPLE_RATE):
                return   # not enough audio yet

            audio        = np.concatenate(list(self._buffer))
            buf_start    = self._buf_start_t
            silent_since = self._silent_since
            generation   = self._generation   # snapshot — detect mid-decode reset

        # RMS energy gate — avoid decoding near-silence (hallucination prevention)
        rms = float(np.sqrt(np.mean(audio ** 2)))
        if rms < RMS_GATE:
            return

        # Run Whisper — this holds _mlx_lock for ~200-400ms
        words = self._decode_with_timestamps(audio, buf_start)

        # Update committed prefix and build partial strings (under lock)
        with self._lock:
            # If _reset() was called while we were decoding (e.g. force_final() ran),
            # the generation counter will have changed — discard this decode entirely
            # to prevent emitting a duplicate stt_final.
            if self._generation != generation:
                return

            self._committed   = self._local_agreement_2(words, self._prev_decode, self._committed)
            self._prev_decode = words

            committed_str = ' '.join(w for w, _, _ in self._committed)

            # Tentative = words in current decode beyond the committed prefix
            committed_set = {(w, round(s, 2)) for w, s, _ in self._committed}
            tentative_str = ' '.join(
                w for w, s, _ in words
                if (w, round(s, 2)) not in committed_set
            )

            # Prune buffer: keep 500ms before last committed word's end-time
            if self._committed:
                self._prune_buffer(self._committed[-1][2] - 0.5)

        # Emit partial — fast callback (socket.emit), OK from decode thread
        if committed_str or tentative_str:
            self.on_partial(committed_str, tentative_str)

        # Final condition: VAD silent for ≥ SILENCE_FINAL_S
        if silent_since is not None and (time.time() - silent_since) >= SILENCE_FINAL_S:
            full = committed_str
            if tentative_str:
                full = (full + ' ' + tentative_str).strip()
            # Capture audio BEFORE _reset() clears the buffer — needed for speaker ID
            audio_snapshot = audio.copy()
            self._reset()
            if full:
                self.on_final(full, audio_snapshot)

    # ── Whisper call ─────────────────────────────────────────────────────────

    def _decode_with_timestamps(self, audio: np.ndarray, buf_start: float):
        """Transcribe audio with word-level timestamps.
        Returns list of (word, abs_start_sec, abs_end_sec).
        Holds the module-level _mlx_lock for the duration of inference.
        """
        from mlx_whisper import transcribe
        from transcriber import _mlx_lock   # module-level lock shared with Transcriber

        with _mlx_lock:
            result = transcribe(
                audio,
                path_or_hf_repo=self._transcriber.model_path,
                word_timestamps=True,
                condition_on_previous_text=False,   # prevent hallucination cascades
                language='en',                      # prevent language drift
                verbose=False,
                no_speech_threshold=0.6,            # raise threshold vs default 0.5
            )

        words = []
        for seg in (result.get('segments') or []):
            for w in (seg.get('words') or []):
                word = (w.get('word') or '').strip()
                if word:
                    words.append((word, buf_start + w.get('start', 0), buf_start + w.get('end', 0)))
        return words

    # ── LocalAgreement-2 ─────────────────────────────────────────────────────

    def _local_agreement_2(self, current, previous, existing_committed):
        """Extend the committed prefix.

        A word at position i is committed when:
          - It appears at position i in both `current` and `previous` decodes
          - Its text matches exactly
          - Its start timestamp agrees within COMMIT_TS_TOL_S
            (falls back to text-only match if either timestamp is 0)

        Already-committed words are a ratchet — never removed.
        Stops at the first position of disagreement.
        """
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
                ts_match = True   # no timestamp available — trust text match only

            if text_match and ts_match:
                committed.append((word, start, _))
            else:
                break   # stop — everything beyond is tentative

        return committed

    # ── Buffer maintenance ────────────────────────────────────────────────────

    def _prune_buffer(self, prune_before: float):
        """Drop buffer chunks whose end-time falls before prune_before.
        Called under self._lock.
        """
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
        """Reset all state after emitting a final. Called from decode thread or force_final().
        Increments _generation so any in-flight _step() that snaphotted the old generation
        will detect the reset and discard its decode result (prevents duplicate stt_final).
        """
        with self._lock:
            self._generation  += 1
            self._buffer.clear()
            self._buf_samples  = 0
            self._buf_start_t  = time.time()
            self._committed    = []
            self._prev_decode  = []
            self._silent_since = None
            self._vad_silent   = False
