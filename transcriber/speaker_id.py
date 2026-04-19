"""
SpeakerIdentifier — pyannote-based speaker embedding for voice identification.

Enrollment: record 30s of candidate audio → compute 512-dim embedding → save to disk.
Identification: compare each utterance embedding to the stored candidate embedding
                using cosine similarity.

Pre-STT diarization support:
  - SpeakerIDWorker: daemon thread that receives completed VAD segments and decides
    CANDIDATE / INTERVIEWER / UNKNOWN before Whisper sees the audio.
  - PendingAudioStore: short-lived store keyed by utterance_id for interviewer enrollment.
  - Dual-embedding: once interviewer voice is enrolled, identify() uses nearest-neighbor
    between candidate + interviewer embeddings for higher accuracy.

Thread safety: identify() is called from the SpeakerIDWorker thread (one caller).
               enroll_from_audio() and enroll_interviewer_snippet() are called from
               HTTP handler threads — one at a time — so no lock is needed there.
               PendingAudioStore uses its own internal lock.

Prerequisites:
  1. HuggingFace account — accept model terms at:
     https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM
  2. Create HF access token at https://huggingface.co/settings/tokens
  3. Add "hf_token": "hf_..." to config/api-keys.json
"""
import logging
import queue
import threading
import time
from enum import Enum
from typing import Optional, Callable
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

# Persistent storage — alongside silero_vad.onnx in the models directory
EMBEDDING_PATH = Path(__file__).parent / 'models' / 'user_embedding.npy'
INTERVIEWER_EMBEDDING_PATH = Path(__file__).parent / 'models' / 'interviewer_embedding.npy'

# pyannote model — ResNet-34 trained on VoxCeleb, 512-dim embeddings
PYANNOTE_MODEL = 'pyannote/wespeaker-voxceleb-resnet34-LM'

# Maximum interviewer snippets to average (more = more robust)
_MAX_INTERVIEWER_SNIPPETS = 5
# Minimum snippet duration (seconds) to accept for interviewer enrollment
_MIN_SNIPPET_SECONDS = 2.0


class SpeakerLabel(Enum):
    CANDIDATE   = "candidate"    # matches enrolled candidate → discard
    INTERVIEWER = "interviewer"  # matches enrolled interviewer → pass to AI
    UNKNOWN     = "unknown"      # no match → pass to AI, offer enrollment popup


class PendingAudioStore:
    """Thread-safe temporary store for utterance audio, keyed by utterance_id.

    Audio buffers are kept for up to max_age_seconds after which they are
    evicted automatically. The store never grows beyond max_entries.
    Used to hold audio that the HUD may want to enroll as interviewer voice.
    """

    def __init__(self, max_age_seconds: int = 300, max_entries: int = 50):
        self._store: dict = {}   # uid → (audio_np, sample_rate, stored_at)
        self._lock = threading.Lock()
        self._max_age = max_age_seconds
        self._max_entries = max_entries

    def store(self, uid: str, audio: np.ndarray, sample_rate: int):
        with self._lock:
            self._evict()
            self._store[uid] = (audio.copy(), sample_rate, time.monotonic())

    def retrieve(self, uid: str) -> tuple:
        """Returns (audio_np, sample_rate) or (None, None) if not found/expired."""
        with self._lock:
            entry = self._store.get(uid)
            if entry:
                return entry[0], entry[1]
            return None, None

    def delete(self, uid: str):
        with self._lock:
            self._store.pop(uid, None)

    def _evict(self):
        now = time.monotonic()
        expired = [k for k, (_, _, t) in self._store.items() if now - t > self._max_age]
        for k in expired:
            del self._store[k]
        while len(self._store) >= self._max_entries:
            oldest = min(self._store, key=lambda k: self._store[k][2])
            del self._store[oldest]


class _PendingSpeechSegment:
    __slots__ = ('utterance_id', 'audio', 'sample_rate')

    def __init__(self, utterance_id: str, audio: np.ndarray, sample_rate: int):
        self.utterance_id = utterance_id
        self.audio        = audio
        self.sample_rate  = sample_rate


class SpeakerIDWorker(threading.Thread):
    """Daemon thread that runs pyannote speaker ID on completed VAD segments.

    Receives segments from the audio callback thread via a queue, identifies
    the speaker (CANDIDATE / INTERVIEWER / UNKNOWN), then calls back into
    StreamingSTT to either discard or release the held decode result.

    This keeps pyannote inference (~200-400ms) off the real-time audio thread.
    """

    def __init__(
        self,
        speaker_identifier,
        pending_audio_store: PendingAudioStore,
        on_pass: Callable[[str], None],
        on_discard: Callable[[str], None],
        on_possible_interviewer: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(daemon=True, name="speaker-id-worker")
        self._speaker_id             = speaker_identifier
        self._pending_audio_store    = pending_audio_store
        self._on_pass                = on_pass
        self._on_discard             = on_discard
        self._on_possible_interviewer = on_possible_interviewer
        self._q: queue.Queue         = queue.Queue()
        self._running                = True

    def submit(self, segment: _PendingSpeechSegment):
        """Queue a speech segment for identification. O(1), safe from audio thread."""
        self._q.put(segment)

    def stop(self):
        self._running = False
        self._q.put(None)   # unblock get()

    def run(self):
        while self._running:
            seg = self._q.get()
            if seg is None:
                break
            try:
                self._process(seg)
            except Exception as e:
                logger.error("SpeakerIDWorker error: %s", e, exc_info=True)
                # Fail-safe: pass through so nothing is silently lost
                self._on_pass(seg.utterance_id)

    def _process(self, seg: _PendingSpeechSegment):
        sid = self._speaker_id
        if sid is None or not sid.is_ready:
            # Model not loaded or candidate not enrolled — pass everything
            self._on_pass(seg.utterance_id)
            return

        label, sim = sid.identify(seg.audio, seg.sample_rate)
        logger.info(
            "SpeakerIDWorker: %s sim=%.3f uid=%.8s",
            label.value, sim, seg.utterance_id,
        )

        if label == SpeakerLabel.CANDIDATE:
            self._on_discard(seg.utterance_id)
        else:
            self._on_pass(seg.utterance_id)
            # Offer interviewer enrollment for UNKNOWN speech when not yet enrolled
            if (label == SpeakerLabel.UNKNOWN
                    and not sid.is_interviewer_enrolled
                    and self._on_possible_interviewer is not None):
                self._pending_audio_store.store(seg.utterance_id, seg.audio, seg.sample_rate)
                self._on_possible_interviewer(seg.utterance_id)


class SpeakerIdentifier:
    """Identifies whether an audio segment belongs to the enrolled candidate.

    Phase 1 (candidate only): binary CANDIDATE / UNKNOWN classification.
    Phase 3 (dual-embedding): nearest-neighbor CANDIDATE / INTERVIEWER / UNKNOWN.
    """

    def __init__(self, hf_token: str, threshold: float = 0.70):
        """
        Args:
            hf_token:  HuggingFace access token for downloading the pyannote model.
            threshold: Cosine similarity floor. Only used in single-embedding mode.
                       In dual-embedding mode, nearest-neighbor decides with a lower
                       combined floor of 0.65.
        """
        self.hf_token  = hf_token
        self.threshold = threshold
        self._model    = None           # pyannote Inference pipeline

        # Candidate embedding
        self._embedding: Optional[np.ndarray] = None
        # Interviewer embedding (averaged from multiple snippets)
        self._interviewer_embedding: Optional[np.ndarray] = None
        self._interviewer_snippets:  list = []   # list of 512-dim embeddings

        # Load previously saved embeddings from disk (survive app restarts)
        self._load_stored_embedding()
        self._load_interviewer_embedding()

    # ── Model loading ─────────────────────────────────────────────────────────

    def load_model(self):
        """Load the pyannote embedding model. Called once at app startup."""
        try:
            from pyannote.audio import Model, Inference
            model = Model.from_pretrained(
                PYANNOTE_MODEL,
                use_auth_token=self.hf_token,
            )
            self._model = Inference(model, window='whole')
            logger.info("SpeakerIdentifier: pyannote model loaded (%s)", PYANNOTE_MODEL)
        except Exception as e:
            logger.error("SpeakerIdentifier: failed to load model — %s", e)
            self._model = None

    # ── Properties ───────────────────────────────────────────────────────────

    @property
    def is_ready(self) -> bool:
        """True only when model is loaded AND candidate voice is enrolled."""
        return self._model is not None and self._embedding is not None

    @property
    def is_model_loaded(self) -> bool:
        return self._model is not None

    @property
    def has_enrollment(self) -> bool:
        return self._embedding is not None

    @property
    def is_enrolled(self) -> bool:
        """Alias for has_enrollment — candidate voice enrolled."""
        return self._embedding is not None

    @property
    def is_interviewer_enrolled(self) -> bool:
        return self._interviewer_embedding is not None

    def interviewer_snippet_count(self) -> int:
        return len(self._interviewer_snippets)

    # ── Candidate enrollment ──────────────────────────────────────────────────

    def enroll_from_audio(self, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """Compute the candidate's voice embedding and persist to disk."""
        if self._model is None:
            logger.error("SpeakerIdentifier: model not loaded — cannot enroll")
            return False
        if len(audio) < sample_rate * 5:
            logger.error("SpeakerIdentifier: audio too short for enrollment (< 5s)")
            return False
        try:
            embedding = self._compute_embedding(audio, sample_rate)
            self._embedding = embedding
            EMBEDDING_PATH.parent.mkdir(parents=True, exist_ok=True)
            np.save(EMBEDDING_PATH, embedding)
            logger.info("SpeakerIdentifier: candidate enrollment saved → %s", EMBEDDING_PATH)
            return True
        except Exception as e:
            logger.error("SpeakerIdentifier: enrollment failed — %s", e)
            return False

    def _load_stored_embedding(self):
        if EMBEDDING_PATH.exists():
            try:
                self._embedding = np.load(EMBEDDING_PATH)
                logger.info("SpeakerIdentifier: loaded candidate embedding from %s", EMBEDDING_PATH)
            except Exception as e:
                logger.warning("SpeakerIdentifier: could not load candidate embedding — %s", e)
                self._embedding = None

    # ── Interviewer enrollment ────────────────────────────────────────────────

    def enroll_interviewer_snippet(self, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """Add one audio snippet to the interviewer embedding pool and re-average.

        Short clips (>= 2s) are accepted. Each additional snippet improves accuracy
        by refining the averaged embedding (up to _MAX_INTERVIEWER_SNIPPETS).
        """
        if self._model is None:
            logger.error("SpeakerIdentifier: model not loaded — cannot enroll interviewer")
            return False
        min_samples = int(_MIN_SNIPPET_SECONDS * sample_rate)
        if len(audio) < min_samples:
            logger.warning("SpeakerIdentifier: interviewer snippet too short (< %.1fs)", _MIN_SNIPPET_SECONDS)
            return False
        try:
            emb = self._compute_embedding(audio, sample_rate)
            self._interviewer_snippets.append(emb)
            # Keep only the most recent N snippets
            if len(self._interviewer_snippets) > _MAX_INTERVIEWER_SNIPPETS:
                self._interviewer_snippets = self._interviewer_snippets[-_MAX_INTERVIEWER_SNIPPETS:]
            self._finalize_interviewer_embedding()
            logger.info(
                "SpeakerIdentifier: interviewer snippet added (%d total)",
                len(self._interviewer_snippets),
            )
            return True
        except Exception as e:
            logger.error("SpeakerIdentifier: interviewer enrollment failed — %s", e)
            return False

    def _finalize_interviewer_embedding(self):
        """Average all stored interviewer snippets, L2-normalize, and save to disk."""
        stacked = np.stack(self._interviewer_snippets)
        avg = stacked.mean(axis=0)
        norm = np.linalg.norm(avg)
        self._interviewer_embedding = avg / (norm + 1e-8)
        INTERVIEWER_EMBEDDING_PATH.parent.mkdir(parents=True, exist_ok=True)
        np.save(INTERVIEWER_EMBEDDING_PATH, self._interviewer_embedding)

    def _load_interviewer_embedding(self):
        if INTERVIEWER_EMBEDDING_PATH.exists():
            try:
                self._interviewer_embedding = np.load(INTERVIEWER_EMBEDDING_PATH)
                logger.info(
                    "SpeakerIdentifier: loaded interviewer embedding from %s",
                    INTERVIEWER_EMBEDDING_PATH,
                )
            except Exception as e:
                logger.warning("SpeakerIdentifier: could not load interviewer embedding — %s", e)
                self._interviewer_embedding = None

    def clear_interviewer_enrollment(self):
        """Remove the stored interviewer embedding."""
        self._interviewer_embedding = None
        self._interviewer_snippets = []
        if INTERVIEWER_EMBEDDING_PATH.exists():
            INTERVIEWER_EMBEDDING_PATH.unlink()
        logger.info("SpeakerIdentifier: interviewer enrollment cleared")

    # ── Identification ────────────────────────────────────────────────────────

    def identify(self, audio: np.ndarray, sample_rate: int = 16000) -> tuple:
        """Identify the speaker in audio.

        Returns (SpeakerLabel, similarity_score).

        Single-embedding mode (no interviewer enrolled):
          - cosine_sim >= threshold  → CANDIDATE
          - else                     → UNKNOWN

        Dual-embedding mode (interviewer enrolled):
          - nearest-neighbor with floor of 0.65:
            if candidate_sim >= interviewer_sim → CANDIDATE
            else                                → INTERVIEWER
          - if neither reaches 0.65             → UNKNOWN

        Fail-safe: returns (UNKNOWN, 0.0) on any error — never silently drops audio.
        """
        if not self.is_ready:
            return SpeakerLabel.UNKNOWN, 0.0
        if len(audio) < sample_rate * 0.5:
            return SpeakerLabel.UNKNOWN, 0.0
        try:
            emb = self._compute_embedding(audio, sample_rate)

            candidate_sim   = self._cosine_similarity(emb, self._embedding)
            interviewer_sim = (
                self._cosine_similarity(emb, self._interviewer_embedding)
                if self._interviewer_embedding is not None
                else -1.0
            )

            if self._interviewer_embedding is not None:
                # Dual-embedding nearest-neighbor
                FLOOR = 0.65
                if candidate_sim >= FLOOR or interviewer_sim >= FLOOR:
                    if candidate_sim >= interviewer_sim:
                        return SpeakerLabel.CANDIDATE, float(candidate_sim)
                    else:
                        return SpeakerLabel.INTERVIEWER, float(interviewer_sim)
                return SpeakerLabel.UNKNOWN, float(max(candidate_sim, interviewer_sim))
            else:
                # Single-embedding threshold
                if candidate_sim >= self.threshold:
                    return SpeakerLabel.CANDIDATE, float(candidate_sim)
                return SpeakerLabel.UNKNOWN, float(candidate_sim)

        except Exception as e:
            logger.warning("SpeakerIdentifier: identify error — %s (treating as UNKNOWN)", e)
            return SpeakerLabel.UNKNOWN, 0.0

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _compute_embedding(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Run pyannote Inference on a numpy audio array → 512-dim embedding."""
        import torch
        waveform = torch.from_numpy(audio.astype(np.float32)).unsqueeze(0)
        result   = self._model({'waveform': waveform, 'sample_rate': sample_rate})
        return np.array(result).flatten()

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
