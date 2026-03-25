"""
Real-time audio recorder using sounddevice for microphone capture
"""
import sounddevice as sd
import numpy as np
import queue
import threading
import logging
from typing import Callable, Optional
from config import SAMPLE_RATE, CHANNELS, BLOCK_SIZE

logger = logging.getLogger(__name__)


class AudioRecorder:
    """Real-time audio recorder with streaming support"""

    def __init__(self,
                 sample_rate: int = SAMPLE_RATE,
                 channels: int = CHANNELS,
                 block_size: int = BLOCK_SIZE,
                 callback: Optional[Callable[[np.ndarray], None]] = None):
        self.sample_rate = sample_rate
        self.channels = channels
        self.block_size = block_size
        self.callback = callback
        self.audio_queue = queue.Queue()
        self.is_recording = False
        self.stream = None

    def _audio_callback(self, indata: np.ndarray, frames: int, time, status):
        if status:
            logger.warning(f"Audio stream status: {status}")
        if self.is_recording:
            audio_chunk = indata.copy()
            try:
                self.audio_queue.put_nowait(audio_chunk)
            except queue.Full:
                logger.warning("Audio queue is full, dropping chunk")
            if self.callback:
                try:
                    self.callback(audio_chunk)
                except Exception as e:
                    logger.error(f"Error in audio callback: {e}")

    def start_recording(self):
        if self.is_recording:
            logger.warning("Recording is already in progress")
            return
        try:
            devices = sd.query_devices()
            logger.info(f"Available audio devices: {len(devices)}")
            default_input = sd.default.device[0]
            logger.info(f"Using default input device: {default_input}")
            self.stream = sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                blocksize=self.block_size,
                callback=self._audio_callback,
                dtype=np.float32,
            )
            self.stream.start()
            self.is_recording = True
            logger.info(f"Started recording at {self.sample_rate}Hz, {self.channels} channel(s)")
        except Exception as e:
            logger.error(f"Failed to start recording: {e}")
            raise

    def stop_recording(self):
        if not self.is_recording:
            return
        self.is_recording = False
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
                self.stream = None
                logger.info("Stopped recording")
            except Exception as e:
                logger.error(f"Error stopping stream: {e}")

    def get_audio_chunk(self, timeout: float = 1.0) -> Optional[np.ndarray]:
        try:
            return self.audio_queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def get_all_audio(self) -> np.ndarray:
        chunks = []
        while not self.audio_queue.empty():
            try:
                chunks.append(self.audio_queue.get_nowait())
            except queue.Empty:
                break
        return np.concatenate(chunks, axis=0) if chunks else np.array([])

    def __enter__(self):
        self.start_recording()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop_recording()
