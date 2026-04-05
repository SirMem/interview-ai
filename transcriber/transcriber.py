"""
Speech-to-text transcriber using MLX Whisper (optimized for Apple Silicon)
or OpenAI Whisper API as an alternative backend.
"""
import io
import logging
import numpy as np
import threading
import wave
from typing import Optional
from config import WHISPER_MODEL, LANGUAGE, SAMPLE_RATE, VAD_ENERGY_GATE_THRESHOLD, VAD_SPEECH_FRAME_RATIO

logger = logging.getLogger(__name__)

# Thread lock for MLX operations (MLX is not fully thread-safe)
_mlx_lock = threading.Lock()

VALID_LOCAL_MODELS = {"tiny", "base", "small", "medium", "large"}
API_MODEL = "whisper-1"


class Transcriber:
    """Real-time speech-to-text transcriber.

    Supports two backends:
    - Local MLX Whisper (default) — runs on Apple Silicon GPU, zero cost
    - OpenAI Whisper API          — cloud-based, requires OPENAI_API_KEY
    """

    def __init__(self,
                 model_size: str = WHISPER_MODEL,
                 language: Optional[str] = LANGUAGE):
        self.model_size = model_size
        self.language = language
        self.use_api = (model_size == API_MODEL)

        if not self.use_api:
            model_paths = {
                "tiny": "mlx-community/whisper-tiny",
                "base": "mlx-community/whisper-base-mlx",
                "small": "mlx-community/whisper-small-mlx",
                "medium": "mlx-community/whisper-medium-mlx",
                "large": "mlx-community/whisper-large-v3-mlx",
            }
            self.model_path = model_paths.get(model_size, f"mlx-community/whisper-{model_size}-mlx")
            logger.info(f"Initializing MLX Whisper with model: {model_size}")
            logger.info(f"Using model path: {self.model_path}")
            logger.info("Using MLX (optimized for Apple Silicon GPU)")
            try:
                import mlx_whisper
                logger.info("MLX Whisper imported successfully")
            except ImportError:
                logger.error("mlx-whisper not installed. Install with: pip install mlx-whisper")
                raise
        else:
            self.model_path = None
            logger.info("Using OpenAI Whisper API (whisper-1)")
            try:
                import openai as _openai_check  # noqa: F401
            except ImportError:
                logger.error("openai package not installed. Install with: pip install openai")
                raise

        self.vad = None
        self._speech_frame_ratio = VAD_SPEECH_FRAME_RATIO
        try:
            import webrtcvad
            self.vad = webrtcvad.Vad(3)
            logger.info("VAD (Voice Activity Detection) initialized")
        except ImportError:
            logger.warning("webrtcvad not installed. VAD will use energy-based fallback.")

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
                logger.error(f"Resampling error: {e}")
                return None
        if not self._has_voice_activity(audio, 16000):
            return None
        return audio

    # Minimum RMS energy to even consider running VAD (energy gate)
    _ENERGY_GATE_THRESHOLD = VAD_ENERGY_GATE_THRESHOLD

    def _has_voice_activity(self, audio: np.ndarray, sample_rate: int) -> bool:
        # Energy gate: skip VAD entirely if the chunk is too quiet
        rms_energy = np.sqrt(np.mean(audio ** 2))
        if rms_energy < self._ENERGY_GATE_THRESHOLD:
            return False

        if self.vad is not None:
            try:
                audio_int16 = (audio * 32767).astype(np.int16)
                frame_duration_ms = 30
                frame_size = int(sample_rate * frame_duration_ms / 1000)
                speech_frames = 0
                total_frames = 0
                for i in range(0, len(audio_int16) - frame_size, frame_size):
                    frame = audio_int16[i:i + frame_size].tobytes()
                    if self.vad.is_speech(frame, sample_rate):
                        speech_frames += 1
                    total_frames += 1
                if total_frames > 0:
                    return (speech_frames / total_frames) >= self._speech_frame_ratio
                return False
            except Exception:
                pass  # Fall through to energy-based check

        return rms_energy > 0.01

    # ------------------------------------------------------------------
    # Local MLX transcription
    # ------------------------------------------------------------------

    def _transcribe_local(self, audio: np.ndarray) -> str:
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
        else:
            return " ".join(
                seg.get("text", "") if isinstance(seg, dict) else str(seg)
                for seg in result
            ).strip()

    # ------------------------------------------------------------------
    # OpenAI Whisper API transcription
    # ------------------------------------------------------------------

    @staticmethod
    def _audio_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
        """Convert a float32 numpy array to in-memory WAV bytes."""
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
        """Return the OpenAI API key from env var or config/api-keys.json."""
        import os, json as _json, pathlib
        key = os.getenv("OPENAI_API_KEY", "")
        if key:
            return key
        # Fall back to project config file (two levels up from transcriber/)
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
            logger.error("OpenAI API key not found. Set OPENAI_API_KEY env var or add 'openai' key in config/api-keys.json")
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
            if self.use_api:
                return self._transcribe_api(validated, 16000)
            else:
                return self._transcribe_local(validated)
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return ""

    def transcribe_chunk(self, audio_chunk: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
        return self.transcribe_audio(audio_chunk, sample_rate)
