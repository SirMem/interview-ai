"""
WASAPI Loopback Audio Capture — captures system audio (speaker output)
using pyaudiowpatch on Windows.

Used as an alternative to the default microphone audio source, allowing
the transcriber to capture VoIP call audio (WeChat, Zoom, etc.) while
the user wears headphones.

Wraps the pyaudiowpatch callback stream with the same interface as
sd.InputStream so the VAD state machine in AlwaysOnListener can
use either source without modification.
"""
import logging
import queue
import threading
import numpy as np

logger = logging.getLogger(__name__)

try:
    import pyaudiowpatch as pyaudio
    _HAS_PYAUDPATCH = True
except ImportError:
    pyaudio = None
    _HAS_PYAUDPATCH = False


def find_loopback_device():
    """Find the default speaker's WASAPI loopback device.

    Returns device_info dict or None if not available.
    The loopback device has a name ending with '[Loopback]' and
    corresponds to the system's default output (speaker/headphones).
    """
    if not _HAS_PYAUDPATCH:
        return None
    try:
        p = pyaudio.PyAudio()
        try:
            wasapi = p.get_host_api_info_by_type(pyaudio.paWASAPI)
            default_out = wasapi['defaultOutputDevice']

            # pyaudiowpatch often lists loopback devices right after the
            # default output in the WASAPI device list. Look for the one
            # with the same base name + '[Loopback]' suffix.
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                if (info['hostApi'] == wasapi['index']
                        and info['maxInputChannels'] > 0
                        and '[Loopback]' in info['name']):
                    # Prefer the one matching the default output device
                    base = p.get_device_info_by_index(default_out)['name']
                    if info['name'].startswith(base.strip()):
                        return {
                            'index': info['index'],
                            'name': info['name'],
                            'channels': info['maxInputChannels'],
                            'sample_rate': int(info['defaultSampleRate']),
                        }

            # Fallback: return the first loopback device that isn't a CABLE
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                if (info['hostApi'] == wasapi['index']
                        and info['maxInputChannels'] > 0
                        and '[Loopback]' in info['name']
                        and 'CABLE' not in info['name']
                        and 'Cable' not in info['name']):
                    return {
                        'index': info['index'],
                        'name': info['name'],
                        'channels': info['maxInputChannels'],
                        'sample_rate': int(info['defaultSampleRate']),
                    }

            # Last resort: return the first loopback device
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                if (info['hostApi'] == wasapi['index']
                        and info['maxInputChannels'] > 0
                        and '[Loopback]' in info['name']):
                    return {
                        'index': info['index'],
                        'name': info['name'],
                        'channels': info['maxInputChannels'],
                        'sample_rate': int(info['defaultSampleRate']),
                    }
            return None
        finally:
            p.terminate()
    except Exception as e:
        logger.warning("Failed to find loopback device: %s", e)
        return None


def is_loopback_available() -> bool:
    """Quick check whether WASAPI loopback is available on this system."""
    if not _HAS_PYAUDPATCH:
        return False
    return find_loopback_device() is not None


class WASAPILoopbackCapture:
    """sd.InputStream-compatible wrapper for WASAPI loopback capture.

    Provides start()/stop()/close() that match the sd.InputStream interface
    so the AlwaysOnListener VAD state machine can use either source.

    Internal callback format:
      pyaudiowpatch (bytes, multi-channel, 48kHz)
        → stereo-to-mono mix
        → librosa.resample 48kHz → 16kHz
        → callback(indata=ndarray, frames, time_info, status)
    """

    def __init__(self, samplerate=16000, blocksize=1600, callback=None):
        self.samplerate = samplerate
        self.blocksize = blocksize
        self.user_callback = callback
        self._stream = None
        self._pyaudio = None
        self._device = None

    def start(self):
        """Open the WASAPI loopback stream and start capture."""
        if not _HAS_PYAUDPATCH:
            raise RuntimeError(
                "pyaudiowpatch not installed. "
                "Run: pip install pyaudiowpatch"
            )
        self._device = find_loopback_device()
        if self._device is None:
            raise RuntimeError(
                "No WASAPI loopback device found. "
                "Your audio driver may not support it."
            )

        self._pyaudio = pyaudio.PyAudio()
        dev_index = self._device['index']
        dev_channels = self._device['channels']
        dev_rate = self._device['sample_rate']

        logger.info(
            "Opening WASAPI loopback: [%d] %s (%dch, %dHz)",
            dev_index, self._device['name'],
            dev_channels, dev_rate,
        )

        self._stream = self._pyaudio.open(
            format=pyaudio.paFloat32,
            channels=dev_channels,
            rate=dev_rate,
            frames_per_buffer=dev_rate // 10,  # 100ms
            input=True,
            input_device_index=dev_index,
            stream_callback=self._pyaudio_callback,
        )
        self._stream.start_stream()
        logger.info("WASAPI loopback capture started")

    def stop(self):
        """Stop the stream (non-blocking)."""
        if self._stream is not None:
            try:
                if self._stream.is_active():
                    self._stream.stop_stream()
            except Exception:
                pass

    def close(self):
        """Close the stream and release resources."""
        self.stop()
        if self._stream is not None:
            try:
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        if self._pyaudio is not None:
            try:
                self._pyaudio.terminate()
            except Exception:
                pass
            self._pyaudio = None
        logger.info("WASAPI loopback capture closed")

    def _pyaudio_callback(self, in_data, frame_count, time_info, status):
        """Internal callback from pyaudiowpatch.

        Converts bytes → numpy ndarray, stereo→mono, 48k→16k,
        then forwards to the user callback with the same signature
        as sd.InputStream callback: (indata, frames, time_info, status).
        """
        if self.user_callback is None:
            return (None, pyaudio.paContinue)

        try:
            # Parse raw bytes → float32 numpy array
            audio = np.frombuffer(in_data, dtype=np.float32)

            # If multi-channel, mix to mono
            if self._device and self._device['channels'] > 1:
                audio = audio.reshape(-1, self._device['channels'])
                audio = np.mean(audio, axis=1)

            # Resample from device rate (typically 48kHz) to 16kHz
            dev_rate = self._device['sample_rate'] if self._device else 48000
            if dev_rate != self.samplerate:
                import librosa
                audio = librosa.resample(
                    audio, orig_sr=dev_rate, target_sr=self.samplerate
                )

            # Ensure we feed roughly matching block sizes
            # ndarray shape: (samples,) — slice or pad to match expected
            expected = self.blocksize
            if len(audio) < expected:
                audio = np.pad(audio, (0, expected - len(audio)), 'constant')
            elif len(audio) > expected:
                audio = audio[:expected]

            # Re-shape to (frames, channels=1) to match sd.InputStream output
            indata = audio.reshape(-1, 1)

            # Forward to the user's VAD callback with sounddevice-style args
            self.user_callback(indata, len(indata), time_info, status)

        except Exception as e:
            logger.error("WASAPI loopback callback error: %s", e, exc_info=True)

        return (None, pyaudio.paContinue)
