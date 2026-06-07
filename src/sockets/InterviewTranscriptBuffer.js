import { logEvent as _logEvent } from '../utils/telemetry.js';
const logMemory = (event, fields = {}) => _logEvent(event, 'INFO', { kind: 'memory', ...fields });

/**
 * Rolling buffer of recent Q&A pairs for conversation context.
 * Maintains the last N Q&A pairs — no compression, no summarization.
 * On overflow, oldest entries are dropped.
 */
class InterviewTranscriptBuffer {
  constructor({ maxEntries = 10 } = {}) {
    this._entries = [];
    this.maxEntries = maxEntries;
    this._utterances = [];
    this._maxUtterances = 30;
  }

  /**
   * Store a Q&A pair. Oldest entries are dropped when over the cap.
   */
  addQAPair(question, answer) {
    const entry = { q: question, a: answer, ts: Date.now() };
    this._entries.push(entry);
    if (this._entries.length > this.maxEntries) {
      this._entries.shift();
    }
    logMemory('qa_pair_added', {
      question: question || '',
      answer: answer || '',
      answer_length: answer?.length || 0,
      memory_size: this._entries.length,
    });
  }

  /**
   * Build memory context string for prompt injection.
   * Returns the last N Q&A pairs as formatted text.
   */
  getMemoryContext() {
    if (this._entries.length === 0) return '';
    const lines = this._entries.map((e, i) => `[${i + 1}] Q: ${e.q}\n    A: ${e.a}`);
    const context = `## Conversation History\n${lines.join('\n')}`;
    logMemory('context_built', {
      entries: this._entries.length,
      chars: context.length,
      context,
    });
    return context;
  }

  addUtterance(text) {
    const id = `u-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    this._utterances.push({ id, text, timestamp: Date.now() });
    if (this._utterances.length > this._maxUtterances) {
      this._utterances.shift();
    }
    return id;
  }

  getTranscriptContext() {
    return this._utterances.map((u) => u.text).join('\n');
  }
}

export default InterviewTranscriptBuffer;
