"""WebRTC VAD engine — extracted from transcriber.py."""
import logging
import numpy as np
from .base import BaseVAD

logger = logging.getLogger(__name__)


class WebRTCVAD(BaseVAD):
    """GMM-based VAD using the webrtcvad library.

    Three-layer detection:
    1. Energy gate — reject chunks below an RMS threshold
    2. WebRTC frame analysis — split into 30ms frames, check speech ratio
    3. Energy fallback — if webrtcvad is unavailable, use simple energy check
    """

    def __init__(self, config: dict):
        self._energy_gate_threshold: float = float(config.get('energy_gate_threshold', 0.02))
        self._speech_frame_ratio: float = float(config.get('speech_frame_ratio', 0.7))
        self._aggressiveness: int = int(config.get('aggressiveness', 3))

        self._vad = None
        try:
            import webrtcvad
            self._vad = webrtcvad.Vad(self._aggressiveness)
            logger.info(f"WebRTC VAD initialized (aggressiveness={self._aggressiveness})")
        except ImportError:
            logger.warning("webrtcvad not installed — using energy-based fallback")

    @property
    def engine_name(self) -> str:
        return "webrtc"

    def speech_probability(self, audio: np.ndarray, sample_rate: int) -> float:
        rms_energy = float(np.sqrt(np.mean(audio ** 2)))
        if rms_energy < self._energy_gate_threshold:
            return 0.0

        if self._vad is not None:
            try:
                audio_int16 = (audio * 32767).astype(np.int16)
                frame_duration_ms = 30
                frame_size = int(sample_rate * frame_duration_ms / 1000)
                speech_frames = 0
                total_frames = 0
                for i in range(0, len(audio_int16) - frame_size, frame_size):
                    frame = audio_int16[i:i + frame_size].tobytes()
                    if self._vad.is_speech(frame, sample_rate):
                        speech_frames += 1
                    total_frames += 1
                if total_frames > 0:
                    return speech_frames / total_frames
                return 0.0
            except Exception:
                pass

        # Fallback: return 1.0 if energy is above a minimum floor
        return 1.0 if rms_energy > 0.01 else 0.0

    def is_speech(self, audio: np.ndarray, sample_rate: int) -> bool:
        return self.speech_probability(audio, sample_rate) >= self._speech_frame_ratio

    def update_config(self, config: dict) -> None:
        if 'energy_gate_threshold' in config:
            self._energy_gate_threshold = float(config['energy_gate_threshold'])
        if 'speech_frame_ratio' in config:
            self._speech_frame_ratio = float(config['speech_frame_ratio'])
        if 'aggressiveness' in config:
            new_agg = int(config['aggressiveness'])
            if new_agg != self._aggressiveness and self._vad is not None:
                self._aggressiveness = new_agg
                self._vad.set_mode(new_agg)
