"""
Deepgram-based listener — streams mic audio to Deepgram's cloud STT (SDK v6).

Drop-in for AlwaysOnListener when DEEPGRAM_ENABLED=true in .env.
Same public interface: start() / stop() / _running / _paused.

Deepgram handles VAD (endpointing) and transcription.
  - Interim results     → stt_partial  (live HUD strip)
  - speech_final=True   → question filter → stt_final → AI
  - UtteranceEnd        → fallback when noise prevents acoustic silence

Diarization:
  - First start: auto-enrolls your voice for DEEPGRAM_ENROLL_SECONDS
  - Saves enrollment audio to config/deepgram_enrollment.pcm
  - Subsequent starts: replays saved audio → identifies your speaker ID → filters it
  - Interviewer's speech passes through to AI

All raw Deepgram transcript events are appended to logs/deepgram_transcript.json.
"""
import json
import logging
import queue
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Optional

import numpy as np
import sounddevice as sd

from config import (
    AUDIO_INPUT_SOURCE,
    DEEPGRAM_MODEL,
    DEEPGRAM_LANGUAGE,
    DEEPGRAM_ENCODING,
    DEEPGRAM_SAMPLE_RATE,
    DEEPGRAM_ENDPOINTING_MS,
    DEEPGRAM_UTTERANCE_END_MS,
    DEEPGRAM_DIARIZE,
    DEEPGRAM_SMART_FORMAT,
    DEEPGRAM_INTERIM_RESULTS,
    DEEPGRAM_MIN_WORD_COUNT,
    DEEPGRAM_ENROLL_SECONDS,
)
import telemetry as _tel

logger = logging.getLogger(__name__)

_SAMPLE_RATE = DEEPGRAM_SAMPLE_RATE
_BLOCK_SIZE  = int(_SAMPLE_RATE * 0.1)   # 100 ms chunks

# Path to saved enrollment audio (raw float32 PCM, 16kHz mono)
_ENROLLMENT_PATH = Path(__file__).parent.parent / 'config' / 'deepgram_enrollment.pcm'

_QUESTION_FIRST_WORDS = {
    'what', 'how', 'why', 'when', 'where', 'who', 'which',
    'can', 'could', 'would', 'should', 'is', 'are', 'do', 'does', 'will',
    'tell', 'explain', 'describe', 'implement', 'write', 'code', 'solve',
    'build', 'design',
}
_GREETING_PREFIXES = (
    'hello', 'hi ', 'hey ', 'good morning', 'good afternoon', 'good evening',
    'nice to meet', 'pleasure to meet', 'thanks', 'thank you',
)
_HALLUCINATIONS = {
    "you", "yeah", "hmm", "uh", "um", "hm", "oh", "ah", "okay", "ok", "bye",
    "thank you", "thanks", "so", "and", "but", "right", "yes", "no",
    "hey", "hi", "hello", "good", "good bye", "goodbye",
}


def _is_answerable(text: str) -> bool:
    stripped    = text.strip()
    lowered     = stripped.lower()
    if any(lowered.startswith(p) for p in _GREETING_PREFIXES):
        return False
    words_lower = lowered.rstrip('.!?, ').split()
    if words_lower and words_lower[-1] in ('bye', 'goodbye'):
        return False
    if stripped.rstrip().endswith('?'):
        return True
    if words_lower and words_lower[0] in _QUESTION_FIRST_WORDS:
        return True
    return True  # conservative: pass borderline utterances through


def _dominant_speaker(words) -> Optional[int]:
    """Return the speaker ID seen most in a word list, or None."""
    if not words:
        return None
    counts = Counter(
        getattr(w, 'speaker', None) for w in words
        if getattr(w, 'speaker', None) is not None
    )
    if not counts:
        return None
    return counts.most_common(1)[0][0]


class DeepgramListener:
    """Streams mic → Deepgram nova-2 → stt_partial / stt_final → Node.

    Diarization-aware: first start auto-enrolls your voice (DEEPGRAM_ENROLL_SECONDS).
    Enrollment audio is saved to config/deepgram_enrollment.pcm and replayed on
    subsequent starts so you are always identified as the same speaker.
    """

    def __init__(self, socket_client, api_key: str):
        self._socket_client  = socket_client
        self._api_key        = api_key
        self._running        = False
        self._paused         = False
        self._audio_queue: queue.Queue = queue.Queue()
        self._ws             = None
        self._ws_ready       = threading.Event()
        self._conn_thread: Optional[threading.Thread] = None
        self._sender_thread: Optional[threading.Thread] = None
        self._stream: Optional[sd.InputStream] = None
        self._log_path       = Path(__file__).parent.parent / 'logs' / 'deepgram_transcript.json'
        self._log_entries: list = []

        # Diarization enrollment
        self._enrolling          = False
        self._user_speaker_id: Optional[int] = None
        self._enrollment_counts: dict = {}
        self._enrollment_audio_buffer: list = []   # float32 chunks saved during enrollment
        self._enroll_seconds     = DEEPGRAM_ENROLL_SECONDS

        # Buffer for UtteranceEnd fallback (noisy environments)
        self._last_final_transcript = ''
        self._last_final_speaker: Optional[int] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        if self._running:
            return
        self._running = True
        self._ws_ready.clear()
        self._log_entries = []
        self._last_final_transcript = ''
        self._last_final_speaker = None
        logger.info("DeepgramListener: starting")

        self._conn_thread = threading.Thread(
            target=self._connection_thread, daemon=True, name="deepgram-conn"
        )
        self._conn_thread.start()

        if not self._ws_ready.wait(timeout=10):
            logger.error("DeepgramListener: timed out waiting for WebSocket — check API key")
            self._running = False
            return

        if self._ws is None:
            logger.error("DeepgramListener: connection failed — not starting mic")
            self._running = False
            return

        self._sender_thread = threading.Thread(
            target=self._sender_loop, daemon=True, name="deepgram-sender"
        )
        self._sender_thread.start()

        self._stream = sd.InputStream(
            samplerate=_SAMPLE_RATE,
            channels=1,
            dtype='float32',
            blocksize=_BLOCK_SIZE,
            callback=self._audio_callback,
            device=int(AUDIO_INPUT_SOURCE) if AUDIO_INPUT_SOURCE.isdigit() else None,
        )
        self._stream.start()
        logger.info("DeepgramListener: mic open (model=%s, endpointing=%dms, diarize=%s)",
                    DEEPGRAM_MODEL, DEEPGRAM_ENDPOINTING_MS, DEEPGRAM_DIARIZE)

        # Enrollment: replay saved audio OR auto-enroll fresh
        if DEEPGRAM_DIARIZE:
            if _ENROLLMENT_PATH.exists():
                threading.Thread(
                    target=self._replay_enrollment, daemon=True, name="deepgram-enroll-replay"
                ).start()
            elif self._enroll_seconds > 0:
                self.start_enrollment()
                logger.info("DG: *** ENROLLMENT — speak now, you have %ds to register your voice ***",
                            self._enroll_seconds)
                threading.Timer(self._enroll_seconds, self._save_and_finish_enrollment).start()

    def stop(self):
        if not self._running:
            return
        self._running = False
        logger.info("DeepgramListener: stopping")

        if self._stream:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None

        self._audio_queue.put(None)  # unblock sender thread

        if self._ws:
            try:
                self._ws.send_close_stream()
            except Exception:
                pass

        self._flush_log()
        logger.info("DeepgramListener: stopped — transcript log at %s", self._log_path)

    def pause(self):
        self._paused = True

    def resume(self):
        self._paused = False

    # ------------------------------------------------------------------
    # Diarization enrollment
    # ------------------------------------------------------------------

    def start_enrollment(self):
        """Begin voice enrollment — speak, then finish_enrollment() locks your ID."""
        self._enrolling = True
        self._enrollment_counts = {}
        self._enrollment_audio_buffer = []
        self._user_speaker_id = None
        logger.info("DG: enrollment started — speak now to register your voice")

    def finish_enrollment(self):
        """Lock in the user's speaker ID based on speech seen during enrollment."""
        self._enrolling = False
        if self._enrollment_counts:
            self._user_speaker_id = max(self._enrollment_counts, key=self._enrollment_counts.get)
            logger.info(
                "DG: enrollment complete — you are speaker %d (counts: %s)",
                self._user_speaker_id, self._enrollment_counts,
            )
        else:
            logger.warning("DG: enrollment finished but no diarized speech detected — filter disabled")

    def _save_and_finish_enrollment(self):
        """Called by auto-enroll timer: save audio buffer to disk then lock speaker ID."""
        self._enrolling = False
        if self._enrollment_audio_buffer:
            try:
                audio = np.concatenate(self._enrollment_audio_buffer)
                _ENROLLMENT_PATH.parent.mkdir(parents=True, exist_ok=True)
                _ENROLLMENT_PATH.write_bytes(audio.astype(np.float32).tobytes())
                logger.info("DG: enrollment audio saved (%d samples) → %s",
                            len(audio), _ENROLLMENT_PATH)
            except Exception as e:
                logger.warning("DG: could not save enrollment audio: %s", e)
        self.finish_enrollment()
        _tel.log('enrollment_complete', user_speaker_id=self._user_speaker_id,
                 method='auto', samples=sum(len(a) for a in self._enrollment_audio_buffer))

    def _replay_enrollment(self):
        """Send saved enrollment audio to Deepgram and identify the user's speaker ID.

        Sets _enrolling=True so on_message tracks which speaker Deepgram assigns
        to the replay audio. After replay + processing delay, finish_enrollment()
        locks in _user_speaker_id so that speaker is filtered from AI answers.
        """
        try:
            # Enable enrollment tracking so on_message updates _enrollment_counts
            self._enrolling = True
            self._enrollment_counts = {}

            audio = np.frombuffer(_ENROLLMENT_PATH.read_bytes(), dtype=np.float32)
            pcm_all = (audio * 32767).astype(np.int16).tobytes()
            chunk_bytes = _BLOCK_SIZE * 2  # 2 bytes per int16 sample
            sent = 0
            while sent < len(pcm_all):
                ws = self._ws
                if ws is None:
                    break
                ws.send_media(pcm_all[sent:sent + chunk_bytes])
                sent += chunk_bytes
                time.sleep(0.1)   # pace to real-time (100ms per chunk)
            logger.info("DG: replayed enrollment audio (%d samples) — waiting for speaker ID", len(audio))
            # Give Deepgram time to process and return is_final transcripts with speaker IDs
            time.sleep(1.5)
            # Lock in the speaker ID seen most during replay
            self.finish_enrollment()
            _tel.log('enrollment_replayed', samples=len(audio), user_speaker_id=self._user_speaker_id)
        except Exception as e:
            logger.warning("DG: enrollment replay failed: %s", e)
            self._enrolling = False

    def clear_enrollment(self):
        """Delete saved enrollment audio — next start will re-enroll from scratch."""
        self._user_speaker_id = None
        self._enrollment_counts = {}
        self._enrollment_audio_buffer = []
        if _ENROLLMENT_PATH.exists():
            _ENROLLMENT_PATH.unlink()
            logger.info("DG: enrollment audio cleared")

    @property
    def enrollment_saved(self) -> bool:
        return _ENROLLMENT_PATH.exists()

    # ------------------------------------------------------------------
    # Connection thread — owns the WebSocket lifetime
    # ------------------------------------------------------------------

    def _connection_thread(self):
        try:
            from deepgram import DeepgramClient
            from deepgram.core.events import EventType
            from deepgram.listen.v1.socket_client import ListenV1Results
            from deepgram.listen.v1.types.listen_v1utterance_end import ListenV1UtteranceEnd
        except ImportError as e:
            logger.error("DeepgramListener: import error: %s", e)
            self._ws_ready.set()
            return

        listener = self  # captured by closures

        def _filter_and_send(transcript: str, speaker: Optional[int], source: str):
            """Apply speaker + question filters, then send to AI."""
            if not transcript:
                return
            _labels = {"event_type": source}
            words = transcript.split()
            if listener._user_speaker_id is not None and speaker == listener._user_speaker_id:
                logger.debug("DG: [%s] skipped (user speaker %d): %.60s", source, speaker, transcript)
                _tel.COUNTER_DEEPGRAM_EVENTS.add(1, {"event_type": "speaker_filtered"})
                _tel.log('utterance_filtered', reason='speaker_filtered',
                         speaker=speaker, word_count=len(words), text=transcript[:80])
                return
            if len(words) < DEEPGRAM_MIN_WORD_COUNT:
                logger.debug("DG: [%s] skipped (too short): %s", source, transcript)
                _tel.COUNTER_DEEPGRAM_EVENTS.add(1, {"event_type": "too_short"})
                _tel.log('utterance_filtered', reason='too_short',
                         word_count=len(words), text=transcript[:80])
                return
            if transcript.lower().strip() in _HALLUCINATIONS:
                logger.debug("DG: [%s] skipped (hallucination): %s", source, transcript)
                _tel.COUNTER_DEEPGRAM_EVENTS.add(1, {"event_type": "too_short"})
                _tel.log('utterance_filtered', reason='hallucination', text=transcript[:80])
                return
            if not _is_answerable(transcript):
                logger.debug("DG: [%s] skipped (not answerable): %s", source, transcript)
                _tel.log('utterance_filtered', reason='not_answerable', text=transcript[:80])
                return
            spk_label = f"speaker{speaker}" if speaker is not None else "speaker?"
            logger.info("DG: [%s] stt_final → AI (%s): %.80s", source, spk_label, transcript)
            _tel.COUNTER_DEEPGRAM_EVENTS.add(1, _labels)
            _tel.log('stt_final_emitted', source=source, speaker=spk_label,
                     word_count=len(words), text=transcript[:120])
            sc = listener._socket_client
            if sc and sc.is_connected():
                sc.send_stt_final(transcript)

        def on_message(msg):
            try:
                # UtteranceEnd arrives on the same MESSAGE event as transcripts
                if isinstance(msg, ListenV1UtteranceEnd):
                    buffered     = listener._last_final_transcript
                    buffered_spk = listener._last_final_speaker
                    listener._last_final_transcript = ''
                    listener._last_final_speaker = None
                    if buffered and not listener._enrolling:
                        _filter_and_send(buffered, buffered_spk, 'utterance_end')
                    return

                if not isinstance(msg, ListenV1Results):
                    return

                alts         = msg.channel.alternatives
                transcript   = alts[0].transcript.strip() if alts else ''
                if not transcript:
                    return

                is_final     = bool(msg.is_final)
                speech_final = bool(msg.speech_final)
                confidence   = alts[0].confidence if alts else None
                words        = alts[0].words if alts else []
                speaker      = _dominant_speaker(words) if DEEPGRAM_DIARIZE else None

                entry = {
                    'ts':           time.time(),
                    'transcript':   transcript,
                    'is_final':     is_final,
                    'speech_final': speech_final,
                    'confidence':   confidence,
                    'speaker':      speaker,
                }
                listener._log_entries.append(entry)

                # Track speaker during enrollment
                if listener._enrolling and is_final and speaker is not None:
                    listener._enrollment_counts[speaker] = (
                        listener._enrollment_counts.get(speaker, 0) + 1
                    )
                    logger.debug("DG: enrollment — heard speaker %d: %.40s", speaker, transcript)

                # Buffer the latest locked-in transcript for UtteranceEnd fallback
                if is_final:
                    listener._last_final_transcript = transcript
                    listener._last_final_speaker = speaker

                if speech_final:
                    listener._flush_log()
                    # Track audio duration + cost for Deepgram nova-2 ($0.0059/min)
                    try:
                        duration_s = float(getattr(msg, 'duration', 0) or 0)
                        if duration_s > 0:
                            _tel.COUNTER_DEEPGRAM_AUDIO_SECONDS.add(duration_s, _tel.get_host_labels() or None)
                            _tel.COUNTER_DEEPGRAM_COST_USD.add(duration_s / 60.0 * 0.0059, _tel.get_host_labels() or None)
                    except Exception:
                        pass
                    buffered     = listener._last_final_transcript
                    buffered_spk = listener._last_final_speaker
                    listener._last_final_transcript = ''
                    listener._last_final_speaker = None
                    if not listener._enrolling:
                        _filter_and_send(buffered, buffered_spk, 'speech_final')

                elif not is_final:
                    sc = listener._socket_client
                    if sc and sc.is_connected():
                        sc.send_stt_partial('', transcript)

                elif is_final and not speech_final:
                    sc = listener._socket_client
                    if sc and sc.is_connected():
                        sc.send_stt_partial(transcript, '')

            except Exception as e:
                logger.error("DG: on_message error: %s", e)

        def on_error(err):
            logger.error("DG: WebSocket error: %s", err)
            _tel.log('deepgram_error', level='ERROR', error=str(err)[:200])

        dg = DeepgramClient(api_key=self._api_key)
        try:
            connect_kwargs = dict(
                model              = DEEPGRAM_MODEL,
                encoding           = DEEPGRAM_ENCODING,
                sample_rate        = _SAMPLE_RATE,
                channels           = 1,
                language           = DEEPGRAM_LANGUAGE,
                smart_format       = 'true' if DEEPGRAM_SMART_FORMAT    else 'false',
                interim_results    = 'true' if DEEPGRAM_INTERIM_RESULTS else 'false',
                endpointing        = DEEPGRAM_ENDPOINTING_MS,
                diarize            = 'true' if DEEPGRAM_DIARIZE         else 'false',
                utterance_end_ms   = DEEPGRAM_UTTERANCE_END_MS,
            )
            with dg.listen.v1.connect(**connect_kwargs) as ws:
                self._ws = ws
                ws.on(EventType.MESSAGE, on_message)
                ws.on(EventType.ERROR,   on_error)
                _tel.GAUGE_DEEPGRAM_CONNECTED.set(1, _tel.get_host_labels() or None)
                _tel.log('deepgram_connected', model=DEEPGRAM_MODEL,
                         endpointing_ms=DEEPGRAM_ENDPOINTING_MS, diarize=DEEPGRAM_DIARIZE)
                self._ws_ready.set()           # unblock start()
                ws.start_listening()           # blocks until connection closes

        except Exception as e:
            logger.error("DG: connection error: %s", e)
            _tel.COUNTER_DEEPGRAM_EVENTS.add(1, {"event_type": "connection_error"})
            _tel.log('deepgram_error', level='ERROR', error=str(e)[:200])
        finally:
            _tel.GAUGE_DEEPGRAM_CONNECTED.set(0, _tel.get_host_labels() or None)
            _tel.log('deepgram_disconnected')
            self._ws = None
            self._ws_ready.set()
            self._running = False

    # ------------------------------------------------------------------
    # Audio capture → Deepgram
    # ------------------------------------------------------------------

    def _audio_callback(self, indata, frames, time_info, status):
        if not self._running or self._paused:
            return
        chunk = indata.copy()
        self._audio_queue.put(chunk)
        # Buffer raw audio during enrollment for saving
        if self._enrolling:
            self._enrollment_audio_buffer.append(chunk.flatten())

    def _sender_loop(self):
        """Read float32 chunks, convert to int16 PCM, send to Deepgram."""
        while self._running:
            try:
                chunk = self._audio_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if chunk is None:   # stop sentinel
                break
            ws = self._ws
            if ws is None:
                continue
            try:
                pcm = (chunk.flatten() * 32767).astype(np.int16)
                ws.send_media(pcm.tobytes())
            except Exception as e:
                logger.warning("DG: send error: %s", e)

    # ------------------------------------------------------------------
    # JSON transcript log
    # ------------------------------------------------------------------

    def _flush_log(self):
        if not self._log_entries:
            return
        try:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            existing: list = []
            if self._log_path.exists():
                with open(self._log_path) as f:
                    try:
                        existing = json.load(f)
                    except json.JSONDecodeError:
                        existing = []
            existing.extend(self._log_entries)
            with open(self._log_path, 'w') as f:
                json.dump(existing, f, indent=2)
            self._log_entries = []
        except Exception as e:
            logger.warning("DG: log flush failed: %s", e)
