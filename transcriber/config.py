"""
Configuration file for the STT system
"""
import os
from typing import Optional

# Socket.IO Configuration
SOCKET_URL: str = os.getenv("SOCKET_URL", "http://localhost:4000")
SOCKET_ENDPOINT: str = os.getenv("SOCKET_ENDPOINT", "/data-updates")

# Audio Configuration
SAMPLE_RATE: int = 16000  # 16kHz optimal for Whisper models
CHUNK_DURATION: float = 2.0  # 2 seconds per chunk
CHANNELS: int = 1  # Mono audio
BLOCK_SIZE: int = int(SAMPLE_RATE * CHUNK_DURATION)  # Samples per chunk

# Whisper Model Configuration (MLX Whisper - optimized for Apple Silicon)
WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "small")  # base, small, medium, large
LANGUAGE: Optional[str] = os.getenv("LANGUAGE", "en")  # None for auto-detect
VAD_FILTER: bool = True  # Voice Activity Detection filter (handled by Whisper internally)
# Note: MLX automatically uses Apple Silicon GPU, no device selection needed

# Question Detection Configuration
QUESTION_PATTERN_CONFIDENCE_THRESHOLD: float = 0.7

# Question words for pattern matching
QUESTION_WORDS: list = [
    "what", "how", "why", "when", "where", "who", "which",
    "can", "could", "would", "should", "will", "shall",
    "is", "are", "was", "were", "do", "does", "did", "have", "has", "had"
]

# Question patterns
QUESTION_PATTERNS: list = [
    "tell me",
    "explain",
    "describe",
    "what about",
    "can you",
    "could you",
    "would you",
    "how do",
    "how does",
    "how did",
    "what do",
    "what does",
    "what did"
]

# API Configuration
API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
API_PORT: int = int(os.getenv("API_PORT", "8000"))
API_WORKERS: int = int(os.getenv("API_WORKERS", "1"))

# Logging
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# Transcriptions Storage Configuration
TRANSCRIPTIONS_JSON_FILE: str = os.getenv("TRANSCRIPTIONS_JSON_FILE", "transcriptions.ndjson")

# Keyboard Configuration
KEYBOARD_ENABLED: bool = os.getenv("KEYBOARD_ENABLED", "false").lower() == "true"
RECORD_KEY: str = os.getenv("RECORD_KEY", "cmd+shift+x")  # Key for push-to-record

# ── Load config from config/api-keys.json ─────────────────────────────────
def _load_json_config() -> dict:
    """Read settings from the shared config file."""
    import json
    import pathlib
    try:
        cfg_path = pathlib.Path(__file__).parent.parent / "config" / "api-keys.json"
        with open(cfg_path) as f:
            return json.load(f)
    except Exception:
        return {}

_app_cfg = _load_json_config()
_vad_cfg = _app_cfg.get("vad", {})

# Always-On Listener Configuration (continuous interviewer speech detection)
ALWAYS_ON_ENABLED: bool = _app_cfg.get("always_on_enabled", False)
ALWAYS_ON_SILENCE_THRESHOLD: float = float(os.getenv("ALWAYS_ON_SILENCE_THRESHOLD", str(_vad_cfg.get("silence_threshold", 1.0))))
ALWAYS_ON_MIN_SPEECH_DURATION: float = float(os.getenv("ALWAYS_ON_MIN_SPEECH_DURATION", str(_vad_cfg.get("min_speech_duration", 0.75))))
ALWAYS_ON_MAX_UTTERANCE_DURATION: float = float(os.getenv("ALWAYS_ON_MAX_UTTERANCE_DURATION", str(_vad_cfg.get("max_utterance_duration", 30.0))))

# VAD engine selection ("webrtc" or "silero")
VAD_ENGINE: str = os.getenv("VAD_ENGINE", _vad_cfg.get("engine", "webrtc"))

# VAD tuning parameters (read from config, overridable via env)
VAD_ENERGY_GATE_THRESHOLD: float = float(os.getenv("VAD_ENERGY_GATE_THRESHOLD", str(_vad_cfg.get("energy_gate_threshold", 0.02))))
VAD_SPEECH_FRAME_RATIO: float = float(os.getenv("VAD_SPEECH_FRAME_RATIO", str(_vad_cfg.get("speech_frame_ratio", 0.7))))
VAD_MIN_WORD_COUNT: int = int(os.getenv("VAD_MIN_WORD_COUNT", str(_vad_cfg.get("min_word_count", 3))))

# Silero VAD parameters
VAD_SILERO_THRESHOLD: float = float(os.getenv("VAD_SILERO_THRESHOLD", str(_vad_cfg.get("silero_threshold", 0.5))))
VAD_SILERO_MIN_SPEECH_MS: int = int(os.getenv("VAD_SILERO_MIN_SPEECH_MS", str(_vad_cfg.get("silero_min_speech_duration_ms", 250))))
VAD_SILERO_MIN_SILENCE_MS: int = int(os.getenv("VAD_SILERO_MIN_SILENCE_MS", str(_vad_cfg.get("silero_min_silence_duration_ms", 100))))
