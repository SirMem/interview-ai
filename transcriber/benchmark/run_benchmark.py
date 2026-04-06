#!/usr/bin/env python3
"""
Side-by-side VAD benchmark runner.

Processes all samples from manifest.json through both WebRTC and Silero VAD
engines, measuring accuracy, latency, and resource usage.

Usage:
    python run_benchmark.py
    python run_benchmark.py --output results/benchmark_2026-04-05.json
"""
import argparse
import json
import os
import sys
from pathlib import Path

# Auto-relaunch with venv python if not already in it
_VENV_PYTHON = Path(__file__).parent.parent / "venv" / "bin" / "python"
if _VENV_PYTHON.exists() and Path(sys.executable).resolve() != _VENV_PYTHON.resolve():
    os.execv(str(_VENV_PYTHON), [str(_VENV_PYTHON)] + sys.argv)
import time
import wave
from pathlib import Path
from typing import Optional

import numpy as np

# Add parent dir so we can import the vad package
sys.path.insert(0, str(Path(__file__).parent.parent))

from vad import create_vad
from vad.metrics import VADMetrics

SAMPLE_RATE = 16000
CHUNK_DURATION = 0.1  # 100ms, matching the real pipeline
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION)

SAMPLES_DIR = Path(__file__).parent / "samples"
MANIFEST_PATH = Path(__file__).parent / "manifest.json"
RESULTS_DIR = Path(__file__).parent / "results"


def load_wav(filepath: Path) -> np.ndarray:
    """Load a WAV file as float32 numpy array."""
    import soundfile as sf
    audio, sr = sf.read(str(filepath), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        ratio = SAMPLE_RATE / sr
        new_len = int(len(audio) * ratio)
        audio = np.interp(
            np.linspace(0, len(audio) - 1, new_len),
            np.arange(len(audio)), audio,
        ).astype(np.float32)
    return audio


def evaluate_engine(engine_name: str, config: dict, samples: list) -> dict:
    """Run all samples through a VAD engine and collect metrics."""
    vad = create_vad(engine_name, config)
    results = []

    for sample in samples:
        filepath = SAMPLES_DIR / sample["filename"]
        if not filepath.exists():
            print(f"  WARNING: {filepath} not found, skipping")
            continue

        audio = load_wav(filepath)
        label = sample["label"]  # ground truth
        chunks = [audio[i:i + CHUNK_SIZE] for i in range(0, len(audio) - CHUNK_SIZE + 1, CHUNK_SIZE)]

        chunk_results = []
        latencies = []
        for chunk in chunks:
            t0 = time.perf_counter()
            prob = vad.speech_probability(chunk, SAMPLE_RATE)
            latency_ms = (time.perf_counter() - t0) * 1000
            latencies.append(latency_ms)

            is_speech = prob >= _get_threshold(vad)
            chunk_results.append({
                "probability": round(prob, 4),
                "is_speech": is_speech,
                "latency_ms": round(latency_ms, 4),
            })

        # Compute per-sample stats
        speech_chunks = sum(1 for c in chunk_results if c["is_speech"])
        total_chunks = len(chunk_results)
        speech_ratio = speech_chunks / total_chunks if total_chunks > 0 else 0.0

        # Classification: if >50% of chunks are speech, classify as "speech-detected"
        predicted_speech = speech_ratio > 0.5

        # Ground truth mapping
        is_actually_speech = label in ("speech", "mixed")

        results.append({
            "filename": sample["filename"],
            "label": label,
            "total_chunks": total_chunks,
            "speech_chunks": speech_chunks,
            "speech_ratio": round(speech_ratio, 4),
            "predicted_speech": predicted_speech,
            "is_actually_speech": is_actually_speech,
            "tp": predicted_speech and is_actually_speech,
            "fp": predicted_speech and not is_actually_speech,
            "tn": not predicted_speech and not is_actually_speech,
            "fn": not predicted_speech and is_actually_speech,
            "avg_probability": round(np.mean([c["probability"] for c in chunk_results]), 4) if chunk_results else 0,
            "avg_latency_ms": round(np.mean(latencies), 4) if latencies else 0,
            "p95_latency_ms": round(np.percentile(latencies, 95), 4) if latencies else 0,
            "p99_latency_ms": round(np.percentile(latencies, 99), 4) if latencies else 0,
            "max_latency_ms": round(max(latencies), 4) if latencies else 0,
        })

        # Reset state between samples
        vad.reset_state()

    # Aggregate
    tp = sum(1 for r in results if r["tp"])
    fp = sum(1 for r in results if r["fp"])
    tn = sum(1 for r in results if r["tn"])
    fn = sum(1 for r in results if r["fn"])

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    accuracy = (tp + tn) / len(results) if results else 0.0

    all_latencies = [r["avg_latency_ms"] for r in results]

    return {
        "engine": engine_name,
        "samples_evaluated": len(results),
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "true_positives": tp,
        "false_positives": fp,
        "true_negatives": tn,
        "false_negatives": fn,
        "avg_latency_ms": round(np.mean(all_latencies), 4) if all_latencies else 0,
        "p95_latency_ms": round(np.percentile(all_latencies, 95), 4) if all_latencies else 0,
        "per_sample": results,
    }


def _get_threshold(vad) -> float:
    if vad.engine_name == "silero":
        return getattr(vad, "_threshold", 0.5)
    return getattr(vad, "_speech_frame_ratio", 0.7)


def print_comparison(webrtc_results: dict, silero_results: dict):
    """Print a human-readable comparison table."""
    print("\n" + "=" * 70)
    print("  VAD ENGINE BENCHMARK COMPARISON")
    print("=" * 70)

    headers = ["Metric", "WebRTC", "Silero", "Winner"]
    metrics = [
        ("Accuracy", "accuracy"),
        ("Precision", "precision"),
        ("Recall", "recall"),
        ("F1 Score", "f1_score"),
        ("True Positives", "true_positives"),
        ("False Positives", "false_positives"),
        ("True Negatives", "true_negatives"),
        ("False Negatives", "false_negatives"),
        ("Avg Latency (ms)", "avg_latency_ms"),
        ("P95 Latency (ms)", "p95_latency_ms"),
    ]

    # Header
    print(f"\n  {'Metric':<25} {'WebRTC':>12} {'Silero':>12} {'Winner':>10}")
    print(f"  {'-'*25} {'-'*12} {'-'*12} {'-'*10}")

    for display_name, key in metrics:
        w = webrtc_results[key]
        s = silero_results[key]

        # Determine winner
        if key in ("false_positives", "false_negatives", "avg_latency_ms", "p95_latency_ms"):
            winner = "WebRTC" if w < s else ("Silero" if s < w else "Tie")
        else:
            winner = "WebRTC" if w > s else ("Silero" if s > w else "Tie")

        w_str = f"{w:.4f}" if isinstance(w, float) else str(w)
        s_str = f"{s:.4f}" if isinstance(s, float) else str(s)
        print(f"  {display_name:<25} {w_str:>12} {s_str:>12} {winner:>10}")

    print(f"\n  Samples evaluated: {webrtc_results['samples_evaluated']}")

    # Recommendation
    w_f1 = webrtc_results["f1_score"]
    s_f1 = silero_results["f1_score"]
    if s_f1 > w_f1 + 0.05:
        print("\n  RECOMMENDATION: Switch to Silero VAD (significantly better F1)")
    elif w_f1 > s_f1 + 0.05:
        print("\n  RECOMMENDATION: Stay with WebRTC VAD (significantly better F1)")
    else:
        print("\n  RECOMMENDATION: Results are close. Consider latency and confidence scores.")
        print("  Silero provides probability outputs for smoother detection.")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Side-by-side VAD benchmark")
    parser.add_argument("--output", type=str, help="Output JSON file path")
    args = parser.parse_args()

    if not MANIFEST_PATH.exists():
        print("ERROR: No manifest.json found. Run collect_samples.py first.")
        sys.exit(1)

    with open(MANIFEST_PATH) as f:
        samples = json.load(f)

    if not samples:
        print("ERROR: manifest.json is empty. Record some samples first.")
        sys.exit(1)

    print(f"Loaded {len(samples)} samples from manifest.json")
    for label in ("speech", "silence", "noise", "mixed"):
        count = sum(1 for s in samples if s["label"] == label)
        if count > 0:
            print(f"  {label}: {count}")

    # WebRTC config (match production defaults)
    webrtc_config = {
        "energy_gate_threshold": 0.015,
        "speech_frame_ratio": 0.45,
        "aggressiveness": 3,
    }

    # Silero config (defaults)
    silero_config = {
        "energy_gate_threshold": 0.015,
        "silero_threshold": 0.5,
    }

    print("\nRunning WebRTC VAD benchmark...")
    webrtc_results = evaluate_engine("webrtc", webrtc_config, samples)

    print("Running Silero VAD benchmark...")
    silero_results = evaluate_engine("silero", silero_config, samples)

    print_comparison(webrtc_results, silero_results)

    # Save results
    output_path = args.output
    if not output_path:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = str(RESULTS_DIR / f"benchmark_{time.strftime('%Y-%m-%d_%H%M%S')}.json")

    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "samples_count": len(samples),
        "webrtc": webrtc_results,
        "silero": silero_results,
    }
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nFull report saved to: {output_path}")


if __name__ == "__main__":
    main()
