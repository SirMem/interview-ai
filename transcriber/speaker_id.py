"""
SpeakerIdentifier — pyannote-based speaker embedding for voice identification.

Enrollment: record 30s of candidate audio → compute 512-dim embedding → save to disk.
Identification: compare each utterance embedding to the stored candidate embedding
                using cosine similarity. Returns True if audio matches the candidate.

Thread safety: identify() and enroll_from_audio() are called from the streaming-stt
               decode thread. The pyannote model itself is not thread-safe; the caller
               (always_on_listener) serialises access via the existing _mlx_lock pattern.
               For enrollment (rare, one-shot), no lock is needed.

Prerequisites:
  1. HuggingFace account — accept model terms at:
     https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM
  2. Create HF access token at https://huggingface.co/settings/tokens
  3. Add "hf_token": "hf_..." to config/api-keys.json
"""
import logging
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

# Persistent storage — alongside silero_vad.onnx in the models directory
EMBEDDING_PATH = Path(__file__).parent / 'models' / 'user_embedding.npy'

# pyannote model — ResNet-34 trained on VoxCeleb, 512-dim embeddings
PYANNOTE_MODEL = 'pyannote/wespeaker-voxceleb-resnet34-LM'


class SpeakerIdentifier:
    """Identifies whether an audio segment belongs to the enrolled candidate."""

    def __init__(self, hf_token: str, threshold: float = 0.70):
        """
        Args:
            hf_token:  HuggingFace access token for downloading the pyannote model.
            threshold: Cosine similarity cutoff. Segments with similarity >= threshold
                       are classified as the candidate. Start at 0.70; raise toward 0.80
                       if the candidate's voice leaks through, lower toward 0.60 if the
                       interviewer is being blocked.
        """
        self.hf_token  = hf_token
        self.threshold = threshold
        self._model    = None           # pyannote Inference pipeline
        self._embedding = None          # stored 512-dim candidate embedding

        # Load previously saved embedding from disk (survives app restarts)
        self._load_stored_embedding()

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
            logger.error("Make sure you accepted the model terms at huggingface.co and the hf_token in config is correct.")
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

    # ── Enrollment ────────────────────────────────────────────────────────────

    def enroll_from_audio(self, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """
        Compute the candidate's voice embedding from raw audio and persist it to disk.

        Args:
            audio:       float32 numpy array at 16000 Hz. 30–60 seconds recommended.
            sample_rate: must be 16000 Hz (matches the rest of the pipeline).

        Returns True on success, False on failure.
        """
        if self._model is None:
            logger.error("SpeakerIdentifier: model not loaded — cannot enroll")
            return False
        if len(audio) < sample_rate * 5:   # require at least 5 seconds
            logger.error("SpeakerIdentifier: audio too short for enrollment (< 5s)")
            return False
        try:
            embedding = self._compute_embedding(audio, sample_rate)
            self._embedding = embedding
            EMBEDDING_PATH.parent.mkdir(parents=True, exist_ok=True)
            np.save(EMBEDDING_PATH, embedding)
            logger.info("SpeakerIdentifier: enrollment saved → %s", EMBEDDING_PATH)
            return True
        except Exception as e:
            logger.error("SpeakerIdentifier: enrollment failed — %s", e)
            return False

    def _load_stored_embedding(self):
        """Load a previously saved embedding from disk at startup."""
        if EMBEDDING_PATH.exists():
            try:
                self._embedding = np.load(EMBEDDING_PATH)
                logger.info("SpeakerIdentifier: loaded stored embedding from %s", EMBEDDING_PATH)
            except Exception as e:
                logger.warning("SpeakerIdentifier: could not load stored embedding — %s", e)
                self._embedding = None

    # ── Identification ────────────────────────────────────────────────────────

    def identify(self, audio: np.ndarray, sample_rate: int = 16000) -> bool:
        """
        Returns True if the audio sounds like the enrolled candidate.
        Returns False (treat as interviewer) if not ready or on error.

        The fail-safe default is False — if anything goes wrong, we assume it's
        the interviewer and send the utterance to AI rather than silently dropping it.
        """
        if not self.is_ready:
            return False
        if len(audio) < sample_rate * 0.5:   # skip very short fragments
            return False
        try:
            embedding  = self._compute_embedding(audio, sample_rate)
            similarity = self._cosine_similarity(embedding, self._embedding)
            is_user    = similarity >= self.threshold
            logger.debug(
                "SpeakerID: similarity=%.3f threshold=%.2f → %s",
                similarity, self.threshold, "CANDIDATE (skip)" if is_user else "INTERVIEWER (send)",
            )
            return is_user
        except Exception as e:
            logger.warning("SpeakerIdentifier: identify error — %s (treating as interviewer)", e)
            return False   # fail-safe: don't silently drop the utterance

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _compute_embedding(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Run pyannote Inference on a numpy audio array → 512-dim embedding."""
        import torch
        # pyannote Inference expects {'waveform': tensor(1, samples), 'sample_rate': int}
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
