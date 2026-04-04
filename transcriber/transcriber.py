"""
Speech-to-text transcriber using MLX Whisper (optimized for Apple Silicon)
"""
import logging
import numpy as np
import threading
from typing import Optional, Iterator
from config import WHISPER_MODEL, LANGUAGE, SAMPLE_RATE

logger = logging.getLogger(__name__)

# Thread lock for MLX operations (MLX is not fully thread-safe)
_mlx_lock = threading.Lock()


class Transcriber:
    """Real-time speech-to-text transcriber using MLX Whisper"""

    def __init__(self,
                 model_size: str = WHISPER_MODEL,
                 language: Optional[str] = LANGUAGE):
        self.model_size = model_size
        self.language = language

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

        self.vad = None
        try:
            import webrtcvad
            self.vad = webrtcvad.Vad(3)
            logger.info("VAD (Voice Activity Detection) initialized")
        except ImportError:
            logger.warning("webrtcvad not installed. VAD will use energy-based fallback.")

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

    def _has_voice_activity(self, audio: np.ndarray, sample_rate: int) -> bool:
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
                    return (speech_frames / total_frames) >= 0.5
                return False
            except Exception:
                pass  # Fall through to energy-based check

        rms_energy = np.sqrt(np.mean(audio ** 2))
        return rms_energy > 0.01

    def transcribe_audio(self, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
        try:
            audio = self._validate_audio(audio, sample_rate)
            if audio is None:
                return ""
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
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return ""

    def transcribe_chunk(self, audio_chunk: np.ndarray, sample_rate: int = SAMPLE_RATE) -> str:
        return self.transcribe_audio(audio_chunk, sample_rate)
