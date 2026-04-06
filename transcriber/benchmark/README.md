# VAD Benchmark

Side-by-side comparison of WebRTC and Silero VAD engines on your own audio samples.

Both engines process the **exact same audio** so results are directly comparable.

## Quick Start

```bash
cd transcriber/benchmark

# 1. Record samples (speak, stay quiet, make noise)
python collect_samples.py

# 2. Run benchmark
python run_benchmark.py
```

No need to activate the venv — scripts handle it automatically.

## Step 1: Collect Samples

```bash
python collect_samples.py
```

It records 5-second clips from your mic. For each clip it asks for a **label**:

| Label    | What to do                                      |
|----------|--------------------------------------------------|
| `speech` | Ask a question or speak normally                 |
| `silence`| Stay completely quiet                            |
| `noise`  | Type on keyboard, tap desk, breathe, move chair  |
| `mixed`  | Start silent then speak, or speak with background noise |

**Record at least 3-4 of each label** for meaningful results.

Type `q` to stop recording.

### Options

```bash
# Change clip duration (default 5s)
python collect_samples.py --duration 3

# Import an existing WAV file instead of recording
python collect_samples.py --import-wav /path/to/file.wav --label speech --note "question about nodejs"
```

Samples are saved as WAV files in `benchmark/samples/` with an index in `manifest.json`.

## Step 2: Run Benchmark

```bash
python run_benchmark.py
```

This processes every sample through both VAD engines in 100ms chunks (matching the live pipeline) and prints:

- **Accuracy, Precision, Recall, F1 Score** per engine
- **True/False Positive/Negative** counts
- **Latency** (avg, p95, p99, max) per engine
- **Winner** per metric
- **Recommendation** based on overall results

A full JSON report is saved to `benchmark/results/`.

### Options

```bash
# Save report to a specific file
python run_benchmark.py --output results/my_test.json
```

## Example Output

```
======================================================================
  VAD ENGINE BENCHMARK COMPARISON
======================================================================

  Metric                       WebRTC       Silero     Winner
  ------------------------- ------------ ------------ ----------
  Accuracy                       0.7500       0.9167     Silero
  Precision                      0.8000       1.0000     Silero
  Recall                         0.8000       0.8000        Tie
  F1 Score                       0.8000       0.8889     Silero
  False Positives                     1            0     Silero
  Avg Latency (ms)               0.2500       1.8000     WebRTC
  P95 Latency (ms)               0.3500       2.5000     WebRTC
```

## What This Tells You

- **High false positives** = engine triggers on noise/silence (wastes Whisper calls)
- **High false negatives** = engine misses real speech
- **F1 Score** = overall balance of precision and recall (higher is better)
- **Latency** = how fast each VAD decision takes (both are well under the 100ms budget)
