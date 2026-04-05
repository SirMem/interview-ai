#!/usr/bin/env python3
"""
Record labeled audio samples for VAD benchmarking.

Usage:
    python collect_samples.py                     # interactive mode
    python collect_samples.py --duration 5        # 5-second clips
    python collect_samples.py --import-wav /path/to/file.wav --label speech

Samples are saved in benchmark/samples/ with a manifest.json index.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import wave
from pathlib import Path

# Auto-relaunch with venv python if not already in it
_VENV_PYTHON = Path(__file__).parent.parent / "venv" / "bin" / "python"
if _VENV_PYTHON.exists() and Path(sys.executable).resolve() != _VENV_PYTHON.resolve():
    os.execv(str(_VENV_PYTHON), [str(_VENV_PYTHON)] + sys.argv)

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLES_DIR = Path(__file__).parent / "samples"
MANIFEST_PATH = Path(__file__).parent / "manifest.json"

VALID_LABELS = {"speech", "silence", "noise", "mixed"}


def load_manifest() -> list:
    if MANIFEST_PATH.exists():
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return []


def save_manifest(entries: list):
    with open(MANIFEST_PATH, "w") as f:
        json.dump(entries, f, indent=2)


def save_wav(filepath: Path, audio: np.ndarray, sample_rate: int):
    pcm = (audio * 32767).astype(np.int16)
    with wave.open(str(filepath), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def record_clip(duration: float) -> np.ndarray:
    print(f"  Recording {duration}s ... ", end="", flush=True)
    audio = sd.rec(int(SAMPLE_RATE * duration), samplerate=SAMPLE_RATE,
                   channels=CHANNELS, dtype="float32")
    sd.wait()
    print("done.")
    return audio.flatten()


def import_wav(filepath: str) -> tuple:
    """Import an existing WAV file. Returns (audio_float32, sample_rate)."""
    import soundfile as sf
    audio, sr = sf.read(filepath, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, sr


def interactive_mode(duration: float):
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    idx = len(manifest)

    print(f"\nVAD Sample Collector — {duration}s clips at {SAMPLE_RATE}Hz")
    print(f"Labels: {', '.join(sorted(VALID_LABELS))}")
    print("Type 'q' to quit.\n")

    while True:
        label = input(f"[{idx}] Label (speech/silence/noise/mixed): ").strip().lower()
        if label == "q":
            break
        if label not in VALID_LABELS:
            print(f"  Invalid label. Choose from: {VALID_LABELS}")
            continue

        note = input(f"  Note (optional): ").strip()

        audio = record_clip(duration)
        rms = float(np.sqrt(np.mean(audio ** 2)))

        filename = f"sample_{idx:04d}_{label}.wav"
        save_wav(SAMPLES_DIR / filename, audio, SAMPLE_RATE)

        entry = {
            "filename": filename,
            "label": label,
            "duration_s": duration,
            "sample_rate": SAMPLE_RATE,
            "rms_energy": round(rms, 6),
            "note": note,
            "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        manifest.append(entry)
        save_manifest(manifest)
        print(f"  Saved: {filename} (RMS={rms:.4f})\n")
        idx += 1

    print(f"\n{len(manifest)} total samples in manifest.")


def import_mode(filepath: str, label: str, note: str = ""):
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    idx = len(manifest)

    audio, sr = import_wav(filepath)
    # Resample if needed
    if sr != SAMPLE_RATE:
        ratio = SAMPLE_RATE / sr
        new_len = int(len(audio) * ratio)
        audio = np.interp(
            np.linspace(0, len(audio) - 1, new_len),
            np.arange(len(audio)), audio,
        ).astype(np.float32)

    rms = float(np.sqrt(np.mean(audio ** 2)))
    duration = len(audio) / SAMPLE_RATE
    filename = f"sample_{idx:04d}_{label}.wav"
    save_wav(SAMPLES_DIR / filename, audio, SAMPLE_RATE)

    entry = {
        "filename": filename,
        "label": label,
        "duration_s": round(duration, 3),
        "sample_rate": SAMPLE_RATE,
        "rms_energy": round(rms, 6),
        "note": note or f"imported from {os.path.basename(filepath)}",
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    manifest.append(entry)
    save_manifest(manifest)
    print(f"Imported: {filename} ({duration:.1f}s, RMS={rms:.4f})")


def main():
    parser = argparse.ArgumentParser(description="Collect labeled audio samples for VAD benchmarking")
    parser.add_argument("--duration", type=float, default=5.0, help="Recording duration in seconds (default: 5)")
    parser.add_argument("--import-wav", type=str, help="Import an existing WAV file instead of recording")
    parser.add_argument("--label", type=str, choices=sorted(VALID_LABELS), help="Label for imported WAV")
    parser.add_argument("--note", type=str, default="", help="Optional note for the sample")
    args = parser.parse_args()

    if args.import_wav:
        if not args.label:
            parser.error("--label is required when using --import-wav")
        import_mode(args.import_wav, args.label, args.note)
    else:
        interactive_mode(args.duration)


if __name__ == "__main__":
    main()
