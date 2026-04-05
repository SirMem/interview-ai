"""VAD engine factory."""
from .base import BaseVAD


def create_vad(engine: str, config: dict) -> BaseVAD:
    """Instantiate a VAD engine by name.

    Args:
        engine: "webrtc" or "silero"
        config: dict of VAD parameters (from api-keys.json vad section)
    """
    if engine == "silero":
        from .silero_vad import SileroVAD
        return SileroVAD(config)
    elif engine == "webrtc":
        from .webrtc_vad import WebRTCVAD
        return WebRTCVAD(config)
    else:
        raise ValueError(f"Unknown VAD engine: {engine!r}. Choose 'webrtc' or 'silero'.")
