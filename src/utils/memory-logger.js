/**
 * Async NDJSON logger dedicated to conversation memory events — logs/memory.jsonl
 *
 * Mirrors file-logger.js: queue + setImmediate + fs.appendFile, fully
 * non-blocking so it never adds latency to the AI flow.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'memory.jsonl');

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
    if (err) process.stderr.write(`[memory-logger] write error: ${err.message}\n`);
    if (_queue.length > 0) setImmediate(_flush);
    else _flushing = false;
  });
}

/**
 * Enqueue a structured memory event for async file write.
 * @param {string} event - e.g. 'qa_pair_added', 'summarize_start', 'summarize_done'
 * @param {object} fields - Additional structured fields
 */
export function logMemory(event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    unix_ts: Date.now() / 1000,
    service: 'memory',
    event,
    ...fields,
  };
  _queue.push(JSON.stringify(entry) + '\n');
  if (!_flushing) {
    _flushing = true;
    setImmediate(_flush);
  }
}
