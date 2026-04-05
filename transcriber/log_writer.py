"""
Async structured NDJSON file writer for the transcriber service.

Non-blocking: log() enqueues entries; a daemon thread flushes to disk.
Writes to logs/app.jsonl — the shared structured log with the Node server.
"""
import json
import os
import threading
from collections import deque
from datetime import datetime, timezone

_LOG_FILE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '..', 'logs', 'app.jsonl')
)
_queue: deque = deque()
_running = False
_thread: threading.Thread | None = None
_lock = threading.Lock()


def log(event: str, level: str = 'INFO', **fields):
    """Non-blocking. Enqueues a structured log entry for async file write."""
    _queue.append({
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'unix_ts': datetime.now(timezone.utc).timestamp(),
        'service': 'transcriber',
        'level': level,
        'event': event,
        **fields,
    })


def _worker():
    while _running or _queue:
        if not _queue:
            threading.Event().wait(0.1)
            continue
        batch = []
        while _queue:
            batch.append(_queue.popleft())
        try:
            with _lock:
                with open(_LOG_FILE, 'a', encoding='utf-8') as f:
                    for entry in batch:
                        f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        except Exception as e:
            print(f'[log_writer] write error: {e}')


def start():
    global _running, _thread
    os.makedirs(os.path.dirname(os.path.abspath(_LOG_FILE)), exist_ok=True)
    _running = True
    _thread = threading.Thread(target=_worker, daemon=True, name='log-writer')
    _thread.start()


def stop():
    global _running
    _running = False
    if _thread and _thread.is_alive():
        _thread.join(timeout=2.0)
