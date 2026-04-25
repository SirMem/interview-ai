"""
SpeakerIdentifier — SpeechBrain ECAPA-TDNN speaker embedding.

Enrollment: record 30s of candidate audio → compute 192-dim embedding → save to disk.
Identification: compare each utterance embedding to the stored candidate embedding
                using cosine similarity.

Binary decision model:
  - CANDIDATE  → audio matches enrolled candidate voice → discard (it's the user)
  - PASS       → anything else → pass to AI (interviewer or unknown)

Device selection: MPS (Apple Silicon) → CUDA (NVIDIA) → CPU fallback.

Thread safety: identify() is called from the SpeakerIDWorker thread (one caller).
               enroll_from_audio() is called from HTTP handler threads — one at a
               time — so no lock is needed there.

Migration from previous pyannote model:
  Old embeddings are 512-dim (pyannote). ECAPA is 192-dim. On startup, shape
  mismatches are detected; the legacy file is renamed to <path>.legacy-512 and
  the user is treated as not-enrolled until they re-enroll.
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

# SpeechBrain ECAPA-TDNN — 22 MB, 192-dim embeddings. No HF token required.
SPEECHBRAIN_MODEL = 'speechbrain/spkrec-ecapa-voxceleb'
ECAPA_EMBEDDING_DIM = 192


def _get_device() -> str:
    """Select the best available device for ECAPA inference.

    Returns 'cuda' (NVIDIA GPU) or 'cpu'. MPS is intentionally excluded —
    SpeechBrain 1.x only sets device_type for 'cpu' and 'cuda'; passing 'mps'
    leaves device_type unset and raises AttributeError during model load.
    ECAPA-TDNN on CPU is fast enough for speaker ID (< 50 ms per utterance).
    """
    try:
        import torch
        if torch.cuda.is_available():
            logger.info("SpeakerIdentifier: using CUDA (NVIDIA GPU)")
            return 'cuda'
    except Exception as e:
        logger.warning("SpeakerIdentifier: device detection error — %s", e)
    logger.info("SpeakerIdentifier: using CPU")
    return 'cpu'


class SpeakerLabel(Enum):
    CANDIDATE = "candidate"    # matches enrolled candidate → discard (it's the user)
    PASS      = "pass"          # anything else → pass to AI (interviewer or unknown)


class _PendingSpeechSegment:
    __slots__ = ('utterance_id', 'audio', 'sample_rate')

    def __init__(self, utterance_id: str, audio: np.ndarray, sample_rate: int):
        self.utterance_id = utterance_id
        self.audio        = audio
        self.sample_rate  = sample_rate


class SpeakerIDWorker(threading.Thread):
    """Daemon thread that runs speaker ID on completed VAD segments.

    Receives segments from the audio callback thread via a queue, classifies
    CANDIDATE / PASS, then calls back into StreamingSTT to either discard or
    release the held decode result.

    cancel_if_uid(uid) marks a UID as stale before the worker invokes its
    callbacks; used when speech resumes after a partial silence (Fix #3).
    """

    def __init__(
        self,
        speaker_identifier,
        on_pass: Callable[[str], None],
        on_discard: Callable[[str], None],
    ):
        super().__init__(daemon=True, name="speaker-id-worker")
        self._speaker_id = speaker_identifier
        self._on_pass    = on_pass
        self._on_discard = on_discard
        self._q: queue.Queue = queue.Queue()
        self._running    = True
        self._stale_uids: set = set()
        self._stale_lock = threading.Lock()

    def submit(self, segment: _PendingSpeechSegment):
        """Queue a speech segment for identification. O(1), safe from audio thread."""
        self._q.put(segment)

    def cancel_if_uid(self, uid: str):
        """Mark a UID as stale. The worker will drop its result when processed.

        Called from the audio callback thread when speech resumes before the full
        silence threshold (mid-sentence pause case, Fix #3).
        """
        with self._stale_lock:
            self._stale_uids.add(uid)

    def _is_stale(self, uid: str) -> bool:
        with self._stale_lock:
            if uid in self._stale_uids:
                self._stale_uids.discard(uid)
                return True
        return False

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
                if not self._is_stale(seg.utterance_id):
                    self._on_pass(seg.utterance_id)

    def _process(self, seg: _PendingSpeechSegment):
        # Drop if speech resumed before full silence threshold
        if self._is_stale(seg.utterance_id):
            logger.debug("SpeakerIDWorker: dropped stale uid=%.8s", seg.utterance_id)
            return

        sid = self._speaker_id
        if sid is None or not sid.is_ready:
            # Model not loaded or candidate not enrolled — pass everything
            self._on_pass(seg.utterance_id)
            return

        # Fix #8 — instrument identify() latency (per-call, attributes set after).
        import telemetry, time as _time
        t0 = _time.perf_counter()
        label, sim = sid.identify(seg.audio, seg.sample_rate)
        elapsed_ms = (_time.perf_counter() - t0) * 1000.0
        try:
            telemetry.HIST_SPEAKER_ID_LATENCY_MS.record(
                elapsed_ms,
                {"label": label.value, "device": getattr(sid, 'device', 'cpu')},
            )
        except Exception:
            pass
        logger.info(
            "SpeakerIDWorker: %s sim=%.3f uid=%.8s (%.0fms)",
            label.value, sim, seg.utterance_id, elapsed_ms,
        )

        if label == SpeakerLabel.CANDIDATE:
            self._on_discard(seg.utterance_id)
        else:
            self._on_pass(seg.utterance_id)


class SpeakerIdentifier:
    """Identifies whether an audio segment belongs to the enrolled candidate.

    Binary classification: CANDIDATE (matches user) vs PASS (anyone else).
    """

    def __init__(self, threshold: float = 0.70):
        """
        Args:
            threshold: Cosine similarity floor. Above → CANDIDATE, below → PASS.
        """
        self.threshold = threshold
        self._model    = None           # SpeechBrain EncoderClassifier
        self._device   = 'cpu'

        # Candidate embedding (192-dim)
        self._embedding: Optional[np.ndarray] = None

        # Load previously saved candidate embedding from disk (survives restarts)
        self._load_stored_embedding()

    # ── Model loading ─────────────────────────────────────────────────────────

    def load_model(self):
        """Load the ECAPA embedding model. Called once at app startup."""
        try:
            from speechbrain.inference.classifiers import EncoderClassifier
            self._device = _get_device()
            self._model = EncoderClassifier.from_hparams(
                source=SPEECHBRAIN_MODEL,
                run_opts={"device": self._device},
            )
            logger.info(
                "SpeakerIdentifier: %s loaded on %s",
                SPEECHBRAIN_MODEL, self._device,
            )
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
    def device(self) -> str:
        return self._device

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
        if not EMBEDDING_PATH.exists():
            return
        try:
            stored = np.load(EMBEDDING_PATH)
            if stored.shape[0] != ECAPA_EMBEDDING_DIM:
                # Legacy 512-dim pyannote embedding — archive and treat as not-enrolled
                legacy_path = EMBEDDING_PATH.with_suffix(
                    EMBEDDING_PATH.suffix + f'.legacy-{stored.shape[0]}'
                )
                EMBEDDING_PATH.rename(legacy_path)
                logger.warning(
                    "SpeakerIdentifier: legacy %d-dim embedding archived to %s — re-enrollment required",
                    stored.shape[0], legacy_path,
                )
                self._embedding = None
                return
            self._embedding = stored
            logger.info("SpeakerIdentifier: loaded candidate embedding from %s", EMBEDDING_PATH)
        except Exception as e:
            logger.warning("SpeakerIdentifier: could not load candidate embedding — %s", e)
            self._embedding = None

    # ── Identification ────────────────────────────────────────────────────────

    def identify(self, audio: np.ndarray, sample_rate: int = 16000) -> tuple:
        """Identify the speaker in audio.

        Returns (SpeakerLabel, similarity_score).

        - cosine_sim >= threshold → CANDIDATE (discard; it's the user)
        - else                    → PASS     (forward to AI)

        Fail-safe: returns (PASS, 0.0) on any error — never silently drops audio
        that might be the interviewer.
        """
        if not self.is_ready:
            return SpeakerLabel.PASS, 0.0
        if len(audio) < sample_rate * 0.5:
            return SpeakerLabel.PASS, 0.0
        try:
            emb = self._compute_embedding(audio, sample_rate)
            sim = self._cosine_similarity(emb, self._embedding)
            if sim >= self.threshold:
                return SpeakerLabel.CANDIDATE, float(sim)
            return SpeakerLabel.PASS, float(sim)
        except Exception as e:
            logger.warning("SpeakerIdentifier: identify error — %s (treating as PASS)", e)
            return SpeakerLabel.PASS, 0.0

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _compute_embedding(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Run ECAPA on a numpy audio array → 192-dim embedding (L2-normalized)."""
        import torch
        waveform = torch.from_numpy(audio.astype(np.float32)).unsqueeze(0)
        # encode_batch returns (1, 1, 192); squeeze to (192,)
        emb = self._model.encode_batch(waveform).squeeze().detach().cpu().numpy()
        # L2-normalize so cosine similarity is a simple dot product
        norm = np.linalg.norm(emb)
        if norm > 0.0:
            emb = emb / norm
        return emb

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        # Embeddings are L2-normalized at compute time, so dot product = cosine
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
