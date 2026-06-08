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
   * Clear all entries and utterances. Used before hydrating
   * from a restored Session's conversation turns.
   */
  clear() {
    this._entries = [];
    this._utterances = [];
  }

  /**
   * Hydrate memory from a list of conversation turns.
   * Clears existing entries first, then loads the most recent
   * N turns (capped at maxEntries) as Q&A pairs.
   *
   * @param {Array} turns - Conversation turns from sessionService.getTurns()
   *   Each turn should have cleaned_question and answer (string) fields.
   *   Falls back cleaned_question → raw_transcript if cleaned is empty.
   */
  hydrateFromTurns(turns) {
    this.clear();
    if (!Array.isArray(turns) || turns.length === 0) return;
    const recent = turns.slice(-this.maxEntries);
    for (const turn of recent) {
      const q = (turn.cleaned_question || turn.raw_transcript || '').trim();
      const a = (turn.answer || '').trim();
      if (q || a) {
        this._entries.push({ q, a, ts: Date.now() });
      }
    }
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
