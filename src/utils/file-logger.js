/**
 * Async structured NDJSON file writer for the Node.js server.
 *
 * Non-blocking: logEvent() enqueues entries; setImmediate batching + fs.appendFile
 * flushes to disk without touching the event loop's hot path.
 * Appends to logs/server.ndjson — never truncates, safe across restarts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'server.ndjson');

// Ensure logs/ directory exists at module load (sync once, at startup)
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

const _queue = [];
let _flushing = false;

function _flush() {
  if (_queue.length === 0) {
    _flushing = false;
    return;
  }
  const batch = _queue.splice(0, _queue.length).join('');
  fs.appendFile(LOG_FILE, batch, (err) => {
    if (err) process.stderr.write(`[file-logger] write error: ${err.message}\n`);
    if (_queue.length > 0) setImmediate(_flush);
    else _flushing = false;
  });
}

/**
 * Enqueue a structured log entry for async file write.
 * @param {string} event - Event type identifier
 * @param {string} level - 'INFO' | 'WARN' | 'ERROR'
 * @param {object} fields - Additional structured fields
 */
export function logEvent(event, level = 'INFO', fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    unix_ts: Date.now() / 1000,
    service: 'server',
    level,
    event,
    ...fields,
  };
  _queue.push(JSON.stringify(entry) + '\n');
  if (!_flushing) {
    _flushing = true;
    setImmediate(_flush);
  }
}
