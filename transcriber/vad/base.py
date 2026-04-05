"""Abstract base class for Voice Activity Detection engines."""
from abc import ABC, abstractmethod
import numpy as np


class BaseVAD(ABC):
    """Interface that all VAD engines must implement."""

    @abstractmethod
    def is_speech(self, audio: np.ndarray, sample_rate: int) -> bool:
        """Return True if the audio chunk contains speech."""

    @abstractmethod
    def speech_probability(self, audio: np.ndarray, sample_rate: int) -> float:
        """Return speech probability in [0.0, 1.0]."""

    @abstractmethod
    def update_config(self, config: dict) -> None:
        """Update VAD parameters at runtime."""

    def reset_state(self) -> None:
        """Reset internal state (e.g. RNN hidden state). No-op by default."""

    @property
    @abstractmethod
    def engine_name(self) -> str:
        """Return the engine identifier string."""
