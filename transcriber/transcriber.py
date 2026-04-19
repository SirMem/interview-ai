"""
Speech-to-text transcriber supporting three backends:
- MLX Whisper     — Apple Silicon only (M1/M2/M3/M4), GPU-accelerated, fastest
- OpenAI Whisper  — Cross-platform local CPU/CUDA (Windows/Linux/Intel Mac)
- OpenAI API      — Cloud Whisper API, requires key + internet
"""
import io
import logging
import platform
import numpy as np
import threading
import wave
from typing import Optional
from config import WHISPER_MODEL, LANGUAGE, SAMPLE_RATE, VAD_ENGINE, VAD_ENERGY_GATE_THRESHOLD, VAD_SPEECH_FRAME_RATIO, WHISPER_BACKEND

from vad import create_vad

logger = logging.getLogger(__name__)

# Thread lock shared by MLX and local Whisper (neither is fully thread-safe)
_mlx_lock = threading.Lock()

VALID_LOCAL_MODELS = {"tiny", "base", "small", "medium", "large"}
API_MODEL = "whisper-1"


def _detect_backend() -> str:
    """Auto-detect the best available backend if not explicitly configured."""
    if WHISPER_BACKEND:
        return WHISPER_BACKEND
    # Apple Silicon Mac → prefer MLX
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "mlx"
    # Everything else → openai-whisper local CPU
    return "local"


class Transcriber:
    """Real-time speech-to-text transcriber.

    Backends (set WHISPER_BACKEND env var or auto-detected):
    - "mlx"   — Local MLX Whisper. Apple Silicon only. Fastest, free.
    - "local" — Local openai-whisper. Windows/Linux/Intel Mac. CPU (or CUDA). Free.
    - "api"   — OpenAI Whisper API (whisper-1). Cloud, needs key + internet.
    """

    def __init__(self,
                 model_size: str = WHISPER_MODEL,
                 language: Optional[str] = LANGUAGE):
        self.model_size = model_size
        self.language = language
        self.use_api = (model_size == API_MODEL)

        if self.use_api:
            self.backend = "api"
            self.model_path = None
            self._local_model = None
            logger.info("Using OpenAI Whisper API (whisper-1)")
            try:
                import openai as _openai_check  # noqa: F401
            except ImportError:
                logger.error("openai package not installed. Install with: pip install openai")
                raise
        else:
            self.backend = _detect_backend()
            self._local_model = None  # lazy-loaded for "local" backend

            if self.backend == "mlx":
                mlx_paths = {
                    "tiny":   "mlx-community/whisper-tiny",
                    "base":   "mlx-community/whisper-base-mlx",
                    "small":  "mlx-community/whisper-small-mlx",
                    "medium": "mlx-community/whisper-medium-mlx",
                    "large":  "mlx-community/whisper-large-v3-mlx",
                }
                self.model_path = mlx_paths.get(model_size, f"mlx-community/whisper-{model_size}-mlx")
                logger.info("Backend: MLX Whisper (Apple Silicon GPU) — model: %s", model_size)
                try:
                    import mlx_whisper
                    logger.info("MLX Whisper imported successfully")
                except ImportError:
                    logger.error("mlx-whisper not installed. Run: pip install mlx-whisper")
                    raise

            elif self.backend == "local":
                self.model_path = model_size  # openai-whisper uses plain names
                logger.info("Backend: openai-whisper (local CPU) — model: %s", model_size)
                try:
                    import whisper as _w
                    logger.info("openai-whisper imported successfully — loading model %s…", model_size)
                    with _mlx_lock:
                        self._local_model = _w.load_model(model_size)
                    logger.info("openai-whisper model loaded: %s", model_size)
                except ImportError:
                    logger.error(
                        "openai-whisper not installed. "
                        "Run: pip install openai-whisper  (or use start.bat --setup on Windows)"
                    )
                    raise

            else:
                raise ValueError(f"Unknown WHISPER_BACKEND: {self.backend!r}. Use 'mlx', 'local', or 'api'.")

        # Pluggable VAD engine
        vad_config = {
            'energy_gate_threshold': VAD_ENERGY_GATE_THRESHOLD,
            'speech_frame_ratio':    VAD_SPEECH_FRAME_RATIO,
        }
        self.vad = create_vad(VAD_ENGINE, vad_config)
        logger.info("VAD engine: %s", self.vad.engine_name)

    # ------------------------------------------------------------------
    # VAD helpers
    # ------------------------------------------------------------------

    def _validate_audio(self, audio: np.ndarray, sample_rate: int) -> Optional[np.ndarray]:
        if audio is None or audio.size == 0:
            return None
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)
        min_samples = int(sample_rate * 0.5)
        if len(audio) < min_samples:
            return None
        audio = audio.astype(np.float32)
        audio_max = np.abs(audio).max()
        if audio_max < 1e-6:
            return None
        if audio_max > 0:
            audio = audio / audio_max
        if sample_rate != 16000:
            try:
                import librosa
                audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
            except Exception as e:
                logger.error("Resampling error: %s", e)
                return None
        if not self.vad.is_speech(audio, 16000):
            return None
        return audio

    # ------------------------------------------------------------------
    # MLX backend
    # ------------------------------------------------------------------

    def _transcribe_mlx(self, audio: np.ndarray) -> str:
        from mlx_whisper import transcribe
        with _mlx_lock:
            result = transcribe(
                audio,
                path_or_hf_repo=self.model_path,
                language=self.language if self.language else None,
                verbose=False,
                condition_on_previous_text=False,
            )
        if isinstance(result, dict):
            return result.get("text", "").strip()
        elif isinstance(result, str):
            return result.strip()
        return " ".join(
            seg.get("text", "") if isinstance(seg, dict) else str(seg)
            for seg in result
        ).strip()

    # ------------------------------------------------------------------
    # openai-whisper local CPU backend
    # ------------------------------------------------------------------

    def _transcribe_local_cpu(self, audio: np.ndarray) -> str:
        with _mlx_lock:
            result = self._local_model.transcribe(
                audio,
                language=self.language if self.language else None,
                verbose=False,
                condition_on_previous_text=False,
                fp16=False,
            )
        return (result.get("text") or "").strip()

    # ------------------------------------------------------------------
    # OpenAI Whisper API backend
    # ------------------------------------------------------------------

    @staticmethod
    def _audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
        pcm = (audio * 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm.tobytes())
        buf.seek(0)
        return buf.read()

    @staticmethod
    def _load_openai_key() -> str:
        import os, json as _json, pathlib
        key = os.getenv("OPENAI_API_KEY", "")
        if key:
            return key
        try:
            cfg_path = pathlib.Path(__file__).parent.parent / "config" / "api-keys.json"
            with open(cfg_path) as f:
                cfg = _json.load(f)
            return cfg.get("keys", {}).get("openai", "")
        except Exception:
            return ""

    def _transcribe_api(self, audio: np.ndarray, sample_rate: int) -> str:
        from openai import OpenAI
        api_key = self._load_openai_key()
        if not api_key:
            logger.error("OpenAI API key not found for Whisper API backend")
            return ""
        client = OpenAI(api_key=api_key)
        wav_bytes = self._audio_to_wav_bytes(audio, sample_rate)
        audio_file = io.BytesIO(wav_bytes)
        audio_file.name = "audio.wav"
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language=self.language if self.language else None,
        )
        return (response.text or "").strip()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def transcribe_audio(self, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
        try:
            validated = self._validate_audio(audio, sample_rate)
            if validated is None:
                return ""
            if self.backend == "mlx":
                return self._transcribe_mlx(validated)
            elif self.backend == "local":
                return self._transcribe_local_cpu(validated)
            else:
                return self._transcribe_api(validated, 16000)
        except Exception as e:
            logger.error("Transcription error: %s", e)
            return ""

    def transcribe_chunk(self, audio_chunk: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
        return self.transcribe_audio(audio_chunk, sample_rate)
