"""
Always-on microphone listener for continuous interviewer speech detection.

Runs a separate audio stream (100ms chunks) with a VAD state machine.

Pre-STT diarization flow (when speaker ID is enabled + enrolled):
  1. VAD detects speech-start → begin_utterance(uid) tagged in StreamingSTT
  2. Audio accumulates in _speech_buffer
  3. VAD detects speech-end → hold_final(uid) on StreamingSTT, speech audio
     submitted to SpeakerIDWorker queue
  4. SpeakerIDWorker runs pyannote (~200-400ms) in background:
       CANDIDATE   → discard(uid): StreamingSTT buffer cleared, no on_final
       INTERVIEWER/UNKNOWN → release_held(uid): on_final fires normally
  5. _on_stt_final filters hallucinations, emits possible_interviewer_speech
     if the utterance was UNKNOWN and interviewer is not yet enrolled
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
    ALWAYS_ON_SILENCE_THRESHOLD,
    ALWAYS_ON_MIN_SPEECH_DURATION,
    ALWAYS_ON_MAX_UTTERANCE_DURATION,
    VAD_MIN_WORD_COUNT,
)
from vad.metrics import VADMetrics
from streaming_stt import StreamingSTT
from speaker_id import SpeakerIDWorker, PendingAudioStore, _PendingSpeechSegment, SpeakerLabel
import log_writer

logger = logging.getLogger(__name__)

_BLOCK_DURATION = 0.1
_BLOCK_SIZE = int(SAMPLE_RATE * _BLOCK_DURATION)
_CHUNK_LOG_SAMPLE_RATE = 0.1


class AlwaysOnListener:
    """Continuously listens to the microphone and emits detected utterances."""

    def __init__(self, transcriber, socket_client, speaker_id=None):
        self._transcriber    = transcriber
        self._socket_client  = socket_client
        self._speaker_id     = speaker_id

        self._paused  = False
        self._running = False
        self._stream  = None
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="aol-transcribe")

        # VAD state
        self._state              = 'silence'
        self._speech_buffer      = []
        self._probability_buffer = []
        self._speech_samples     = 0
        self._silent_frames      = 0
        self._force_flushed      = False

        self._min_word_count            = VAD_MIN_WORD_COUNT
        self._silence_frames_threshold  = int(ALWAYS_ON_SILENCE_THRESHOLD / _BLOCK_DURATION)
        self._min_speech_samples        = int(ALWAYS_ON_MIN_SPEECH_DURATION * SAMPLE_RATE)
        self._max_speech_samples        = int(ALWAYS_ON_MAX_UTTERANCE_DURATION * SAMPLE_RATE)

        # Pre-STT diarization state
        self._current_utterance_id: Optional[str] = None
        # UIDs flagged by SpeakerIDWorker as UNKNOWN — popup should be shown
        self._pending_popup_uids: set = set()

        # PendingAudioStore holds raw audio for possible interviewer enrollment
        self._pending_audio_store = PendingAudioStore(max_age_seconds=300, max_entries=50)

        # SpeakerIDWorker — only created when speaker ID is available
        self._speaker_id_worker: Optional[SpeakerIDWorker] = None
        if speaker_id is not None:
            self._speaker_id_worker = SpeakerIDWorker(
                speaker_identifier=speaker_id,
                pending_audio_store=self._pending_audio_store,
                on_pass=self._on_speaker_pass,
                on_discard=self._on_speaker_discard,
                on_possible_interviewer=self._on_possible_interviewer,
            )

        self.metrics = VADMetrics()

        self._streaming_stt = StreamingSTT(
            transcriber=self._transcriber,
            on_partial=self._on_stt_partial,
            on_final=self._on_stt_final,
        )

    # ── SpeakerIDWorker callbacks (called from worker thread) ─────────────────

    def _on_speaker_pass(self, utterance_id: str):
        """Speaker ID decided: not candidate. Release the held STT result."""
        self._streaming_stt.release_held(utterance_id)

    def _on_speaker_discard(self, utterance_id: str):
        """Speaker ID decided: candidate. Discard the STT buffer."""
        self._streaming_stt.discard(utterance_id)

    def _on_possible_interviewer(self, utterance_id: str):
        """SpeakerIDWorker flagged UNKNOWN with no interviewer enrolled.
        Mark uid so _on_stt_final can emit the popup event with the transcript text.
        """
        self._pending_popup_uids.add(utterance_id)

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

        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=_BLOCK_SIZE,
            callback=self._audio_callback,
        )
        self._stream.start()
        self._streaming_stt.start()
        logger.info(
            "AlwaysOnListener started "
            "(silence_threshold=%ss, min_speech=%ss, pre-stt-diarization=%s)",
            ALWAYS_ON_SILENCE_THRESHOLD,
            ALWAYS_ON_MIN_SPEECH_DURATION,
            "enabled" if self._speaker_id_worker else "disabled",
        )
        log_writer.log('always_on_started',
                       silence_threshold=ALWAYS_ON_SILENCE_THRESHOLD,
                       min_speech=ALWAYS_ON_MIN_SPEECH_DURATION,
                       max_utterance=ALWAYS_ON_MAX_UTTERANCE_DURATION,
                       min_word_count=self._min_word_count,
                       pre_stt_diarization=self._speaker_id_worker is not None)

    def stop(self):
        self._running = False
        self._streaming_stt.force_final()
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
        if random.random() < _CHUNK_LOG_SAMPLE_RATE:
            log_writer.log('vad_chunk', **record)

        if is_speech:
            # Detect speech-start transition (silence → speech)
            if self._state != 'speech':
                uid = str(uuid.uuid4())
                self._current_utterance_id = uid
                self._streaming_stt.begin_utterance(uid)

            self._state = 'speech'
            self._silent_frames = 0
            self._speech_buffer.append(chunk)
            self._probability_buffer.append(prob)
            self._speech_samples += len(chunk)

            if self._speech_samples >= self._max_speech_samples:
                self._force_flushed = True
                self._submit_to_speaker_id_worker()
                self._flush_utterance()
        else:
            if self._state == 'speech':
                self._silent_frames += 1
                self._speech_buffer.append(chunk)
                self._probability_buffer.append(prob)
                self._speech_samples += len(chunk)

                if self._silent_frames >= self._silence_frames_threshold:
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
        """At VAD speech-end: hold StreamingSTT and submit audio to SpeakerIDWorker.
        If worker is not available, StreamingSTT proceeds normally (no-op here).
        """
        uid = self._current_utterance_id
        if not uid or not self._speech_buffer:
            return
        if self._speaker_id_worker is None:
            return  # speaker ID disabled — STT proceeds normally

        speech_audio = np.concatenate(self._speech_buffer)
        self._streaming_stt.hold_final(uid)
        seg = _PendingSpeechSegment(uid, speech_audio, SAMPLE_RATE)
        self._speaker_id_worker.submit(seg)

    # ------------------------------------------------------------------
    # Utterance flushing (VAD state reset only)
    # ------------------------------------------------------------------

    def _flush_utterance(self):
        self._reset_vad()

    def _reset_vad(self):
        self._state              = 'silence'
        self._speech_buffer      = []
        self._probability_buffer = []
        self._speech_samples     = 0
        self._silent_frames      = 0
        self._force_flushed      = False
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

    # ── StreamingSTT callbacks ────────────────────────────────────────────────

    def _on_stt_partial(self, committed: str, tentative: str):
        if self._socket_client and self._socket_client.is_connected():
            self._socket_client.send_stt_partial(committed, tentative)

    def _on_stt_final(self, text: str, audio: np.ndarray, utterance_id: Optional[str] = None):
        """Called by StreamingSTT when VAD silence ≥ 1s (or force_final on stop).

        Speaker ID filtering has already happened pre-STT — this callback only
        fires for non-candidate speech. Applies hallucination / length filters,
        optionally triggers the interviewer enrollment popup, then emits to Node.
        """
        words = text.strip().split()
        if len(words) < self._min_word_count:
            logger.debug("STT final too short (%d words), skipping: %r", len(words), text)
            return
        if text.strip().lower().rstrip('.!?,') in self._HALLUCINATIONS:
            logger.debug("STT final matched hallucination list, skipping: %r", text)
            return
        if self._is_gibberish(text):
            logger.debug("STT final is gibberish, skipping: %r", text)
            return

        # Interviewer enrollment popup — only offer for long enough utterances so
        # we don't spam the user on short filler words from an unknown speaker.
        # 5 words ≈ ~3-4s of speech.
        _POPUP_MIN_WORDS = 5
        if (utterance_id
                and utterance_id in self._pending_popup_uids
                and len(words) >= _POPUP_MIN_WORDS
                and self._socket_client
                and self._socket_client.is_connected()):
            self._pending_popup_uids.discard(utterance_id)
            excerpt = text.strip()[:80]
            self._socket_client.send_possible_interviewer(utterance_id, excerpt)
            logger.info(
                "Offered interviewer enrollment for uid=%.8s (%d words): %r",
                utterance_id, len(words), excerpt,
            )
        elif utterance_id in self._pending_popup_uids:
            # Too short — discard the uid so the audio store can evict it
            self._pending_popup_uids.discard(utterance_id)

        logger.info("STT Final: %s", text)
        print(f"Interviewer (streaming): {text}")
        log_writer.log('stt_final_emitted', text=text, word_count=len(words))

        if self._socket_client and self._socket_client.is_connected():
            self._socket_client.send_stt_final(text)
