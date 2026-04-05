"""Thread-safe VAD metrics with a rolling 5-minute window."""
import threading
import time
from collections import deque
from typing import Optional


class VADMetrics:
    """Collects per-chunk and per-utterance VAD metrics.

    All data is kept in a rolling 5-minute deque so memory stays bounded.
    """

    _WINDOW_SECONDS = 300  # 5 minutes

    def __init__(self):
        self._lock = threading.Lock()
        self._chunks: deque = deque()       # (timestamp, record_dict)
        self._utterances: deque = deque()   # (timestamp, record_dict)
        self._total_chunks = 0
        self._total_utterances = 0

    # ── Per-chunk recording ──────────────────────────────────────────

    def record_chunk(
        self,
        engine: str,
        rms_energy: float,
        energy_gate_passed: bool,
        speech_probability: float,
        is_speech: bool,
        latency_ms: float,
    ) -> dict:
        """Record a single VAD chunk decision. Returns the record dict."""
        now = time.time()
        record = {
            'engine': engine,
            'rms_energy': round(rms_energy, 6),
            'energy_gate_passed': energy_gate_passed,
            'speech_probability': round(speech_probability, 4),
            'is_speech': is_speech,
            'latency_ms': round(latency_ms, 3),
            'timestamp': now,
        }
        with self._lock:
            self._chunks.append((now, record))
            self._total_chunks += 1
            self._prune()
        return record

    # ── Per-utterance recording ──────────────────────────────────────

    def record_utterance(
        self,
        engine: str,
        utterance_duration_s: float,
        chunk_count: int,
        avg_speech_probability: float,
        min_speech_probability: float,
        max_speech_probability: float,
        silent_frames_at_end: int,
        force_flushed: bool,
        transcription_result: str,
        was_filtered: bool,
        filter_reason: Optional[str],
    ) -> dict:
        """Record a flushed utterance with its metrics. Returns the record dict."""
        now = time.time()
        record = {
            'engine': engine,
            'utterance_duration_s': round(utterance_duration_s, 3),
            'chunk_count': chunk_count,
            'avg_speech_probability': round(avg_speech_probability, 4),
            'min_speech_probability': round(min_speech_probability, 4),
            'max_speech_probability': round(max_speech_probability, 4),
            'silent_frames_at_end': silent_frames_at_end,
            'force_flushed': force_flushed,
            'transcription_result': transcription_result,
            'was_filtered': was_filtered,
            'filter_reason': filter_reason,
            'timestamp': now,
        }
        with self._lock:
            self._utterances.append((now, record))
            self._total_utterances += 1
            self._prune()
        return record

    # ── Rolling summary ──────────────────────────────────────────────

    def get_summary(self) -> dict:
        """Return aggregated metrics over the rolling window."""
        with self._lock:
            self._prune()
            chunks = [r for _, r in self._chunks]
            utterances = [r for _, r in self._utterances]

        if not chunks:
            return {
                'engine': None,
                'window_seconds': self._WINDOW_SECONDS,
                'total_chunks_processed': self._total_chunks,
                'total_utterances': self._total_utterances,
                'speech_chunks': 0,
                'silence_chunks': 0,
                'speech_ratio': 0.0,
                'utterances_flushed': 0,
                'utterances_filtered': 0,
                'filter_breakdown': {'too_short': 0, 'hallucination': 0, 'gibberish': 0},
                'avg_chunk_latency_ms': 0.0,
                'p95_chunk_latency_ms': 0.0,
                'avg_speech_probability': 0.0,
            }

        speech_chunks = sum(1 for c in chunks if c['is_speech'])
        silence_chunks = len(chunks) - speech_chunks
        latencies = sorted(c['latency_ms'] for c in chunks)
        speech_probs = [c['speech_probability'] for c in chunks if c['is_speech']]

        utterances_filtered = sum(1 for u in utterances if u['was_filtered'])
        filter_breakdown = {'too_short': 0, 'hallucination': 0, 'gibberish': 0}
        for u in utterances:
            if u['was_filtered'] and u['filter_reason'] in filter_breakdown:
                filter_breakdown[u['filter_reason']] += 1

        p95_idx = min(int(len(latencies) * 0.95), len(latencies) - 1)

        return {
            'engine': chunks[-1]['engine'] if chunks else None,
            'window_seconds': self._WINDOW_SECONDS,
            'total_chunks_processed': self._total_chunks,
            'total_utterances': self._total_utterances,
            'speech_chunks': speech_chunks,
            'silence_chunks': silence_chunks,
            'speech_ratio': round(speech_chunks / len(chunks), 4) if chunks else 0.0,
            'utterances_flushed': len(utterances),
            'utterances_filtered': utterances_filtered,
            'filter_breakdown': filter_breakdown,
            'avg_chunk_latency_ms': round(sum(latencies) / len(latencies), 3),
            'p95_chunk_latency_ms': round(latencies[p95_idx], 3),
            'avg_speech_probability': round(sum(speech_probs) / len(speech_probs), 4) if speech_probs else 0.0,
        }

    # ── Internal ─────────────────────────────────────────────────────

    def _prune(self):
        """Remove entries older than the rolling window. Must hold self._lock."""
        cutoff = time.time() - self._WINDOW_SECONDS
        while self._chunks and self._chunks[0][0] < cutoff:
            self._chunks.popleft()
        while self._utterances and self._utterances[0][0] < cutoff:
            self._utterances.popleft()
