"""Silero VAD engine — DNN-based via ONNX Runtime."""
import logging
import pathlib
import urllib.request

import numpy as np

from .base import BaseVAD

logger = logging.getLogger(__name__)

_MODEL_DIR = pathlib.Path(__file__).parent.parent / "models"
_MODEL_FILE = _MODEL_DIR / "silero_vad.onnx"
_MODEL_URL = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"


def _ensure_model() -> pathlib.Path:
    """Download the Silero VAD ONNX model if not present."""
    if _MODEL_FILE.exists():
        return _MODEL_FILE
    _MODEL_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading Silero VAD model to {_MODEL_FILE} ...")
    urllib.request.urlretrieve(_MODEL_URL, _MODEL_FILE)
    logger.info("Silero VAD model downloaded successfully")
    return _MODEL_FILE


class SileroVAD(BaseVAD):
    """DNN-based VAD using Silero's ONNX model (~1.7 MB).

    Matches the official OnnxWrapper from the silero-vad package:
    - 512-sample windows at 16kHz
    - 64-sample context buffer prepended to each window
    - RNN hidden state carried across calls
    """

    _WINDOW_SIZE = 512   # samples at 16kHz per inference call
    _CONTEXT_SIZE = 64   # context samples prepended to each window

    def __init__(self, config: dict):
        self._threshold: float = float(config.get('silero_threshold', 0.5))
        self._energy_gate_threshold: float = float(config.get('energy_gate_threshold', 0.02))

        # Load ONNX model
        import onnxruntime
        model_path = str(_ensure_model())
        opts = onnxruntime.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self._session = onnxruntime.InferenceSession(model_path, sess_options=opts)

        # RNN hidden state — shape [2, 1, 128] for Silero v5
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        # Context buffer — last 64 samples from previous window
        self._context = np.zeros(self._CONTEXT_SIZE, dtype=np.float32)
        self._sample_rate = np.array(16000, dtype=np.int64)

        logger.info(f"Silero VAD initialized (threshold={self._threshold})")

    @property
    def engine_name(self) -> str:
        return "silero"

    def _infer_window(self, window_512: np.ndarray) -> float:
        """Run one 512-sample window through the model with context."""
        # Prepend context (64 samples) to make input 576 samples
        x = np.concatenate([self._context, window_512]).reshape(1, -1)

        ort_inputs = {
            'input': x,
            'state': self._state,
            'sr': self._sample_rate,
        }
        out, self._state = self._session.run(None, ort_inputs)

        # Save last 64 samples as context for next call
        self._context = x[0, -self._CONTEXT_SIZE:].copy()

        return float(out.squeeze())

    def speech_probability(self, audio: np.ndarray, sample_rate: int) -> float:
        # Energy gate: skip DNN if chunk is clearly silent
        rms_energy = float(np.sqrt(np.mean(audio ** 2)))
        if rms_energy < self._energy_gate_threshold:
            return 0.0

        # Ensure float32
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            ratio = 16000 / sample_rate
            new_len = int(len(audio) * ratio)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, new_len),
                np.arange(len(audio)),
                audio,
            ).astype(np.float32)

        # Split into 512-sample windows, run each through model with context.
        # Return max probability across sub-windows.
        max_prob = 0.0
        ws = self._WINDOW_SIZE
        for i in range(0, len(audio) - ws + 1, ws):
            prob = self._infer_window(audio[i:i + ws])
            if prob > max_prob:
                max_prob = prob

        return max_prob

    def is_speech(self, audio: np.ndarray, sample_rate: int) -> bool:
        return self.speech_probability(audio, sample_rate) >= self._threshold

    def update_config(self, config: dict) -> None:
        if 'silero_threshold' in config:
            self._threshold = float(config['silero_threshold'])
        if 'energy_gate_threshold' in config:
            self._energy_gate_threshold = float(config['energy_gate_threshold'])

    def reset_state(self) -> None:
        """Reset RNN hidden state and context — call between utterances."""
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros(self._CONTEXT_SIZE, dtype=np.float32)
