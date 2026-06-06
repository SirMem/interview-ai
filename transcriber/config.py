"""
Configuration for the STT system — all settings read from root .env file.
"""
import os
from pathlib import Path
from typing import Optional

# Load .env from project root (two levels up from this file)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env", override=True)
except ImportError:
    pass  # python-dotenv not installed; rely on environment vars set by start.sh

# ── Socket.IO ─────────────────────────────────────────────────────────────────
SOCKET_URL:     str = os.getenv("SOCKET_URL",     "http://localhost:4000")
SOCKET_ENDPOINT:str = os.getenv("SOCKET_ENDPOINT", "/data-updates")

# ── Audio ──────────────────────────────────────────────────────────────────────
SAMPLE_RATE: int   = 16000   # Hz — optimal for Whisper and Deepgram
CHUNK_DURATION: float = 2.0  # seconds per Whisper chunk
CHANNELS: int      = 1
BLOCK_SIZE: int    = int(SAMPLE_RATE * CHUNK_DURATION)

# Audio input source (device index or name). Empty string = system default microphone.
# Set to an index like "12" for Stereo Mix (captures system audio including VoIP calls).
AUDIO_INPUT_SOURCE: str = os.getenv("AUDIO_INPUT_SOURCE", "")

# ── Whisper ────────────────────────────────────────────────────────────────────
WHISPER_MODEL:   str = os.getenv("STT_MODEL",      "small")
LANGUAGE: Optional[str] = os.getenv("LANGUAGE",    "en") or None
WHISPER_BACKEND: str = os.getenv("WHISPER_BACKEND", "")

# ── API server ─────────────────────────────────────────────────────────────────
API_HOST:    str = os.getenv("API_HOST",    "0.0.0.0")
API_PORT:    int = int(os.getenv("API_PORT",    "8000"))
API_WORKERS: int = int(os.getenv("API_WORKERS", "1"))

# ── Logging ────────────────────────────────────────────────────────────────────
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

# ── Keyboard ───────────────────────────────────────────────────────────────────
KEYBOARD_ENABLED: bool = os.getenv("KEYBOARD_ENABLED", "false").lower() == "true"
RECORD_KEY:        str = os.getenv("RECORD_KEY", "cmd+shift+x")

# ── Deepgram cloud STT ────────────────────────────────────────────────────────
DEEPGRAM_ENABLED:         bool = os.getenv("DEEPGRAM_ENABLED",         "false").lower() == "true"
DEEPGRAM_API_KEY:          str = os.getenv("DEEPGRAM_API_KEY",         "")
DEEPGRAM_MODEL:            str = os.getenv("DEEPGRAM_MODEL",           "nova-2")
DEEPGRAM_LANGUAGE:         str = os.getenv("DEEPGRAM_LANGUAGE",        "en")
DEEPGRAM_ENCODING:         str = os.getenv("DEEPGRAM_ENCODING",        "linear16")
DEEPGRAM_SAMPLE_RATE:      int = int(os.getenv("DEEPGRAM_SAMPLE_RATE", "16000"))
DEEPGRAM_ENDPOINTING_MS:   int = int(os.getenv("DEEPGRAM_ENDPOINTING_MS",  "300"))
DEEPGRAM_UTTERANCE_END_MS: int = int(os.getenv("DEEPGRAM_UTTERANCE_END_MS","1000"))
DEEPGRAM_DIARIZE:         bool = os.getenv("DEEPGRAM_DIARIZE",         "true").lower()  == "true"
DEEPGRAM_SMART_FORMAT:    bool = os.getenv("DEEPGRAM_SMART_FORMAT",    "true").lower()  == "true"
DEEPGRAM_INTERIM_RESULTS: bool = os.getenv("DEEPGRAM_INTERIM_RESULTS", "true").lower()  == "true"
DEEPGRAM_MIN_WORD_COUNT:   int = int(os.getenv("DEEPGRAM_MIN_WORD_COUNT", "2"))
DEEPGRAM_ENROLL_SECONDS:   int = int(os.getenv("DEEPGRAM_ENROLL_SECONDS", "5"))

# ── VAD — Voice Activity Detection (Whisper path only) ───────────────────────
VAD_ENGINE:               str   = os.getenv("VAD_ENGINE",               "silero")
VAD_ENERGY_GATE_THRESHOLD:float = float(os.getenv("VAD_ENERGY_GATE_THRESHOLD", "0.015"))
VAD_SPEECH_FRAME_RATIO:   float = float(os.getenv("VAD_SPEECH_FRAME_RATIO",    "0.45"))
VAD_MIN_WORD_COUNT:        int   = int(os.getenv("VAD_MIN_WORD_COUNT",          "5"))

ALWAYS_ON_SILENCE_THRESHOLD:      float = float(os.getenv("VAD_SILENCE_THRESHOLD",    "0.3"))
ALWAYS_ON_MIN_SPEECH_DURATION:    float = float(os.getenv("VAD_MIN_SPEECH_DURATION",  "0.5"))
ALWAYS_ON_MAX_UTTERANCE_DURATION: float = float(os.getenv("VAD_MAX_UTTERANCE_DURATION","30.0"))

VAD_SILERO_THRESHOLD:      float = float(os.getenv("VAD_SILERO_THRESHOLD",       "0.7"))
VAD_SILERO_MIN_SPEECH_MS:   int  = int(os.getenv("VAD_SILERO_MIN_SPEECH_MS",    "100"))
VAD_SILERO_MIN_SILENCE_MS:  int  = int(os.getenv("VAD_SILERO_MIN_SILENCE_MS",   "250"))

# ── Speaker identification (Whisper path only) ────────────────────────────────
SPEAKER_ID_ENABLED:   bool  = os.getenv("SPEAKER_ID_ENABLED",  "false").lower() == "true"
SPEAKER_ID_THRESHOLD: float = float(os.getenv("SPEAKER_ID_THRESHOLD", "0.6"))

# ── HF token (legacy — no longer required for speaker ID) ────────────────────
HF_TOKEN: str = os.getenv("HF_TOKEN", "")

# ── Telemetry ──────────────────────────────────────────────────────────────────
# Assembled into a dict so telemetry.py can call init_telemetry(cfg) unchanged.
def get_telemetry_cfg() -> dict:
    return {
        "telemetry": {
            "enabled":        os.getenv("TELEMETRY_ENABLED",        "false").lower() == "true",
            "otlp_endpoint":  os.getenv("OTLP_ENDPOINT",            ""),
            "instance_id":    os.getenv("GRAFANA_INSTANCE_ID",      ""),
            "access_token":   os.getenv("GRAFANA_ACCESS_TOKEN",     ""),
            "service_prefix": os.getenv("TELEMETRY_SERVICE_PREFIX", "solvewatch"),
        },
        "host_owner": os.getenv("HOST_OWNER", ""),
    }

# Backwards-compatible alias used by main.py and telemetry.py
_app_cfg = get_telemetry_cfg()
