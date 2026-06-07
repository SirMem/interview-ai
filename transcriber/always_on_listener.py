"""
Always-on microphone listener for continuous speech detection.

Runs a separate audio stream (100ms chunks) with a VAD state machine.

Pre-STT speaker ID flow (when enabled + enrolled):
  1. VAD detects speech-start → begin_utterance(uid) tagged in StreamingSTT
  2. Audio accumulates in _speech_buffer during speech
  3. Speech → silence transition: submit speech audio to SpeakerIDWorker
     immediately (runs in parallel with the silence-wait, Fix #3). StreamingSTT
     is held for this uid until speaker ID decides.
  4. SpeakerIDWorker classifies CANDIDATE / PASS in the background:
       CANDIDATE → discard(uid): STT buffer cleared, no on_final
       PASS      → release_held(uid): on_final fires normally
  5. If speech resumes before the full silence threshold: cancel the in-flight
     speaker ID decision (stale uid is dropped).
  6. _on_stt_final applies the answerable pre-filter, hallucination/gibberish
     checks, then emits to Node.
"""
import logging
import random
import threading
import time
import uuid
import numpy as np
import sounddevice as sd
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from config import (
    SAMPLE_RATE,
    AUDIO_SOURCE_MODE,
    get_audio_input_device,
    ALWAYS_ON_SILENCE_THRESHOLD,
    ALWAYS_ON_MIN_SPEECH_DURATION,
    ALWAYS_ON_MAX_UTTERANCE_DURATION,
    VAD_MIN_WORD_COUNT,
)
from vad.metrics import VADMetrics
from streaming_stt import StreamingSTT
from speaker_id import SpeakerIDWorker, _PendingSpeechSegment
import telemetry as log_writer

logger = logging.getLogger(__name__)

_BLOCK_DURATION = 0.1
_BLOCK_SIZE = int(SAMPLE_RATE * _BLOCK_DURATION)
_CHUNK_LOG_SAMPLE_RATE = 0.1


# Question-word first-tokens that unambiguously mark an answerable utterance
_QUESTION_FIRST_WORDS = {
    'what', 'how', 'why', 'when', 'where', 'who', 'which',
    'can', 'could', 'would', 'should', 'is', 'are', 'do', 'does', 'will',
    'tell', 'explain', 'describe', 'implement', 'write', 'code', 'solve',
    'build', 'design',
}

# Greeting prefixes that indicate small talk — skip
_GREETING_PREFIXES = (
    'hello', 'hi ', 'hey ', 'good morning', 'good afternoon', 'good evening',
    'nice to meet', 'pleasure to meet', 'thanks', 'thank you',
)


class AlwaysOnListener:
    """Continuously listens to the microphone and emits detected utterances."""

    def __init__(self, transcriber, socket_client, speaker_id=None,
                 auto_answer_disabled: bool = False):
        self._transcriber    = transcriber
        self._socket_client  = socket_client
        self._speaker_id     = speaker_id
        # Fix #7: when True, suppress stt_final emissions (manual mode still works).
        # Set by main.py when speaker ID model failed to load or user isn't enrolled.
        self._auto_answer_disabled = auto_answer_disabled

        self._paused  = False
        self._running = False
        self._stream  = None
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aol-transcribe")

        # VAD state
        self._state              = 'silence'
        self._speech_buffer      = []
        self._speech_samples     = 0
        self._silent_frames      = 0

        self._min_word_count            = VAD_MIN_WORD_COUNT
        self._silence_frames_threshold  = int(ALWAYS_ON_SILENCE_THRESHOLD / _BLOCK_DURATION)
        self._min_speech_samples        = int(ALWAYS_ON_MIN_SPEECH_DURATION * SAMPLE_RATE)
        self._max_speech_samples        = int(ALWAYS_ON_MAX_UTTERANCE_DURATION * SAMPLE_RATE)

        # Pre-STT speaker ID state
        self._current_utterance_id: Optional[str] = None
        # Fix #3: tracks whether we've already submitted this utterance to speaker-ID
        # so the final-silence-threshold handler doesn't double-submit.
        self._sid_submitted_for_uid: Optional[str] = None

        # SpeakerIDWorker — only created when speaker ID is available
        self._speaker_id_worker: Optional[SpeakerIDWorker] = None
        if speaker_id is not None:
            self._speaker_id_worker = SpeakerIDWorker(
                speaker_identifier=speaker_id,
                on_pass=self._on_speaker_pass,
                on_discard=self._on_speaker_discard,
            )

        self.metrics = VADMetrics()

        self._streaming_stt = StreamingSTT(
            transcriber=self._transcriber,
            on_partial=self._on_stt_partial,
            on_final=self._on_stt_final,
        )

    def set_auto_answer_disabled(self, disabled: bool):
        """Fix #7: flip the auto-answer gate at runtime (e.g., when enrollment changes)."""
        self._auto_answer_disabled = disabled

    def attach_speaker_id(self, identifier):
        """Wire a SpeakerIdentifier into a listener that was built without one.

        Constructor only creates the SpeakerIDWorker when `speaker_id` is passed
        at init time. If the user later turns speaker-ID on via the settings
        page (hitting /load-speaker-id or /enroll-voice), the listener's
        `_speaker_id` reference was updated but the worker stayed None — so
        _submit_to_speaker_id_worker silently returned and no identify() call
        was ever made. This method plugs that gap: it sets the reference and
        also spins up + starts the worker if needed.
        """
        self._speaker_id = identifier
        if identifier is None:
            return
        if self._speaker_id_worker is None:
            self._speaker_id_worker = SpeakerIDWorker(
                speaker_identifier=identifier,
                on_pass=self._on_speaker_pass,
                on_discard=self._on_speaker_discard,
            )
            if self._running:
                self._speaker_id_worker.start()
            logger.info("SpeakerIDWorker attached dynamically (enrolled=%s)",
                        getattr(identifier, 'has_enrollment', False))
        else:
            # Worker already exists — just update the identifier reference inside
            # it so fresh enrollment embeddings are picked up on next identify().
            self._speaker_id_worker._speaker_id = identifier

    # ── SpeakerIDWorker callbacks (called from worker thread) ─────────────────

    def _on_speaker_pass(self, utterance_id: str):
        """Speaker ID decided: not candidate. Release the held STT result."""
        self._streaming_stt.release_held(utterance_id)

    def _on_speaker_discard(self, utterance_id: str):
        """Speaker ID decided: candidate. Discard the STT buffer."""
        self._streaming_stt.discard(utterance_id)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        if self._running:
            return
        if self._executor._shutdown:
            self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aol-transcribe")
        self._running = True

        if self._speaker_id_worker is not None:
            self._speaker_id_worker.start()

        if AUDIO_SOURCE_MODE == 'system':
            from system_audio_capture import WASAPILoopbackCapture
            self._stream = WASAPILoopbackCapture(
                samplerate=SAMPLE_RATE,
                blocksize=_BLOCK_SIZE,
                callback=self._audio_callback,
            )
            self._stream.start()
            logger.info(
                "AlwaysOnListener started (system audio / WASAPI loopback, " +
                "speaker_id=%s, auto_answer=%s)",
                "enabled" if self._speaker_id_worker else "disabled",
                "disabled" if self._auto_answer_disabled else "enabled",
            )
        else:
            _device_idx, _channels = get_audio_input_device()
            self._stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=_channels,
                dtype='float32',
                blocksize=_BLOCK_SIZE,
                callback=self._audio_callback,
                device=_device_idx,
            )
            self._stream.start()
            logger.info(
                "AlwaysOnListener started " +
                "(silence_threshold=%ss, min_speech=%ss, speaker_id=%s, " +
                "auto_answer=%s, device=%s)",
                ALWAYS_ON_SILENCE_THRESHOLD,
                ALWAYS_ON_SILENCE_THRESHOLD,
                "enabled" if self._speaker_id_worker else "disabled",
                "disabled" if self._auto_answer_disabled else "enabled",
            )

        self._streaming_stt.start()
        log_writer.log('always_on_started',
                       silence_threshold=ALWAYS_ON_SILENCE_THRESHOLD,
                       min_speech=ALWAYS_ON_MIN_SPEECH_DURATION,
                       max_utterance=ALWAYS_ON_MAX_UTTERANCE_DURATION,
                       min_word_count=self._min_word_count,
                       speaker_id_enabled=self._speaker_id_worker is not None,
                       auto_answer_disabled=self._auto_answer_disabled)
        try:
            import telemetry
            telemetry.GAUGE_LISTENER_ACTIVE.set(1)
        except Exception:
            pass

    def stop(self):
        self._running = False
        try:
            import telemetry
            telemetry.GAUGE_LISTENER_ACTIVE.set(0)
        except Exception:
            pass
        # Stop means stop — any audio still in the rolling buffer is discarded.
        # We only ever fire stt_final on a genuine VAD silence, never on shutdown.
        self._streaming_stt.stop()
        if self._speaker_id_worker is not None:
            self._speaker_id_worker.stop()
        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as e:
                logger.warning("Error stopping always-on stream: %s", e)
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
        self._transcriber.vad.update_config(config)
        if 'silence_threshold' in config:
            self._silence_frames_threshold = int(float(config['silence_threshold']) / _BLOCK_DURATION)
        if 'min_speech_duration' in config:
            self._min_speech_samples = int(float(config['min_speech_duration']) * SAMPLE_RATE)
        if 'max_utterance_duration' in config:
            self._max_speech_samples = int(float(config['max_utterance_duration']) * SAMPLE_RATE)
        if 'min_word_count' in config:
            self._min_word_count = int(config['min_word_count'])
        logger.info("VAD config updated: %s", config)
        log_writer.log('vad_config_applied', config=config)

    # ------------------------------------------------------------------
    # Audio callback (runs in audio thread — must be fast)
    # ------------------------------------------------------------------

    def _audio_callback(self, indata, frames, time_info, status):
        if not self._running or self._paused:
            return

        chunk = indata[:, 0].copy()

        vad = self._transcriber.vad
        t0 = time.perf_counter()
        prob = vad.speech_probability(chunk, SAMPLE_RATE)
        latency_ms = (time.perf_counter() - t0) * 1000

        is_speech = prob >= self._get_threshold()
        rms_energy = float(np.sqrt(np.mean(chunk ** 2)))

        record = self.metrics.record_chunk(
            engine=vad.engine_name,
            rms_energy=rms_energy,
            energy_gate_passed=(prob > 0.0),
            speech_probability=prob,
            is_speech=is_speech,
            latency_ms=latency_ms,
        )
        # The vad_chunk LOG is sampled — ~10 records/s would flood Loki.
        if random.random() < _CHUNK_LOG_SAMPLE_RATE:
            log_writer.log('vad_chunk', **record)

        # VAD per-chunk latency histogram — record EVERY chunk. Histograms are
        # SDK-aggregated (buckets + counts), so per-chunk record() is ~1 µs and
        # carries no cardinality cost. Sampling this was only hiding the real
        # distribution from panel 410.
        try:
            import telemetry
            telemetry.HIST_VAD_LATENCY_MS.record(latency_ms, {"engine": vad.engine_name})
        except Exception:
            pass

        if is_speech:
            # Fix #3: if speech resumed while speaker ID was in-flight, cancel it
            # so the stale decision doesn't land on the new utterance.
            if (self._sid_submitted_for_uid is not None
                    and self._speaker_id_worker is not None
                    and self._sid_submitted_for_uid == self._current_utterance_id):
                self._speaker_id_worker.cancel_if_uid(self._sid_submitted_for_uid)
                # Release the STT hold so the utterance-in-progress flows normally
                self._streaming_stt.release_held(self._sid_submitted_for_uid)
                self._sid_submitted_for_uid = None

            # Detect speech-start transition (silence → speech)
            if self._state != 'speech':
                uid = str(uuid.uuid4())
                self._current_utterance_id = uid
                self._streaming_stt.begin_utterance(uid)
                # Fix #8 — count one detected utterance per VAD speech-start
                try:
                    import telemetry
                    telemetry.COUNT_UTTERANCES_DETECTED.add(1)
                except Exception:
                    pass

            self._state = 'speech'
            self._silent_frames = 0
            self._speech_buffer.append(chunk)
            self._speech_samples += len(chunk)

            if self._speech_samples >= self._max_speech_samples:
                self._submit_to_speaker_id_worker()
                self._flush_utterance()
        else:
            if self._state == 'speech':
                self._silent_frames += 1
                self._speech_buffer.append(chunk)
                self._speech_samples += len(chunk)

                # Submit to speaker ID on the FIRST silent frame so ECAPA inference
                # runs in parallel with the silence wait, not after it. Guard with
                # audio-length check — speaker ID needs ≥ 500ms to be useful.
                if (self._silent_frames == 1
                        and self._speech_samples >= self._min_speech_samples):
                    self._submit_to_speaker_id_worker()

                if self._silent_frames >= self._silence_frames_threshold:
                    # In case early submit didn't fire (audio was too short), try now
                    self._submit_to_speaker_id_worker()
                    self._flush_utterance()

        self._streaming_stt.feed(chunk)
        self._streaming_stt.set_vad_silent(not is_speech)

    def _get_threshold(self) -> float:
        vad = self._transcriber.vad
        if vad.engine_name == 'silero':
            return getattr(vad, '_threshold', 0.5)
        return getattr(vad, '_speech_frame_ratio', 0.7)

    # ------------------------------------------------------------------
    # Pre-STT speaker ID submission
    # ------------------------------------------------------------------

    def _submit_to_speaker_id_worker(self):
        """Hold StreamingSTT and submit audio to SpeakerIDWorker.

        Called either:
          - at speech→silence transition (Fix #3, parallel with silence wait), OR
          - at full silence threshold (fallback if audio was too short at transition).

        Idempotent per-utterance via `_sid_submitted_for_uid`.
        """
        uid = self._current_utterance_id
        if not uid or not self._speech_buffer:
            return
        if self._speaker_id_worker is None:
            return  # speaker ID disabled — STT proceeds normally
        if self._sid_submitted_for_uid == uid:
            return  # already submitted this utterance

        speech_audio = np.concatenate(self._speech_buffer)
        self._streaming_stt.hold_final(uid)
        seg = _PendingSpeechSegment(uid, speech_audio, SAMPLE_RATE)
        self._speaker_id_worker.submit(seg)
        self._sid_submitted_for_uid = uid

    # ------------------------------------------------------------------
    # Utterance flushing (VAD state reset only)
    # ------------------------------------------------------------------

    def _flush_utterance(self):
        self._reset_vad()

    def _reset_vad(self):
        self._state              = 'silence'
        self._speech_buffer      = []
        self._speech_samples     = 0
        self._silent_frames      = 0
        self._sid_submitted_for_uid = None
        self._transcriber.vad.reset_state()

    # ── Known Whisper hallucinations on silence/noise ─────────────────────────

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
        words = text.strip().split()
        if len(words) < 4:
            return False
        from collections import Counter
        counts = Counter(w.lower() for w in words)
        most_common_count = counts.most_common(1)[0][1]
        if most_common_count / len(words) >= 0.6:
            return True
        bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1)]
        if bigrams:
            bigram_counts = Counter(bigrams)
            if bigram_counts.most_common(1)[0][1] >= 3:
                return True
        return False

    @staticmethod
    def _is_answerable(text: str) -> tuple:
        """Fix #6: cheap pre-filter.

        Returns (answerable, reason). `reason` is a short label ("greeting",
        "goodbye", "ok") when the utterance should be skipped, or None when it
        should be answered.
        """
        stripped = text.strip()
        lowered  = stripped.lower()

        # Greetings / small talk → skip
        if any(lowered.startswith(p) for p in _GREETING_PREFIXES):
            return False, "greeting"

        # Goodbyes → skip
        words_lower = lowered.rstrip('.!?, ').split()
        if words_lower and words_lower[-1] in ('bye', 'goodbye'):
            return False, "goodbye"

        # Question mark → definite pass
        if stripped.rstrip().endswith('?'):
            return True, None

        # First word is a question/imperative word → pass
        if words_lower and words_lower[0] in _QUESTION_FIRST_WORDS:
            return True, None

        # Default: pass through (conservative — better to answer borderline than skip real question)
        return True, None

    # ── StreamingSTT callbacks ────────────────────────────────────────────────

    def _on_stt_partial(self, committed: str, tentative: str):
        if self._socket_client and self._socket_client.is_connected():
            self._socket_client.send_stt_partial(committed, tentative)

    def _on_stt_final(self, text: str, audio: np.ndarray,
                      utterance_id: Optional[str] = None,
                      silence_started_at: Optional[float] = None):
        """Called by StreamingSTT when the VAD silence threshold is reached.

        Speaker ID filtering has already happened pre-STT — this callback only
        fires for non-candidate speech. Applies answerable + hallucination + length
        filters, then emits to Node unless auto-answer is disabled (Fix #7).

        silence_started_at is forwarded across the socket boundary so Node can
        compose end_to_end_question_ms when the first AI token emits (Fix #8).
        """
        import telemetry
        words = text.strip().split()

        # Fix #6: greeting / goodbye / non-question pre-filter
        answerable, skip_reason = self._is_answerable(text)
        if not answerable:
            logger.debug("STT final skipped (%s): %r", skip_reason, text)
            log_writer.log('stt_final_discarded', reason=skip_reason, text=text[:80])
            telemetry.COUNT_UTTERANCES_DISCARDED.add(1, {"reason": skip_reason})
            return

        if len(words) < self._min_word_count:
            logger.debug("STT final too short (%d words), skipping: %r", len(words), text)
            log_writer.log('stt_final_discarded', reason='too_short', word_count=len(words))
            telemetry.COUNT_UTTERANCES_DISCARDED.add(1, {"reason": "too_short"})
            return
        if text.strip().lower().rstrip('.!?,') in self._HALLUCINATIONS:
            logger.debug("STT final matched hallucination list, skipping: %r", text)
            log_writer.log('stt_final_discarded', reason='hallucination', text=text[:80])
            telemetry.COUNT_UTTERANCES_DISCARDED.add(1, {"reason": "hallucination"})
            return
        if self._is_gibberish(text):
            logger.debug("STT final is gibberish, skipping: %r", text)
            log_writer.log('stt_final_discarded', reason='gibberish', text=text[:80])
            telemetry.COUNT_UTTERANCES_DISCARDED.add(1, {"reason": "gibberish"})
            return

        # Fix #7: if speaker ID model isn't usable, suppress auto-emit.
        # User must use manual mode (⌘⇧X) to get an answer.
        if self._auto_answer_disabled:
            logger.info("Auto-answer disabled; skipping stt_final emit for: %r", text[:80])
            log_writer.log('stt_final_discarded', reason='auto_answer_disabled', text=text[:80])
            telemetry.COUNT_UTTERANCES_DISCARDED.add(1, {"reason": "auto_answer_disabled"})
            return

        logger.info("STT Final: %s", text)
        print(f"Interviewer (streaming): {text}")
        log_writer.log('stt_final_emitted', text=text, word_count=len(words),
                       uid=utterance_id, silence_started_at=silence_started_at)
        telemetry.COUNT_UTTERANCES_PASSED.add(1)

        if self._socket_client and self._socket_client.is_connected():
            self._socket_client.send_stt_final(text, uid=utterance_id,
                                               silence_started_at=silence_started_at)
