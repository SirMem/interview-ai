/**
 * Rolling buffer of interviewer utterances and detected question queue.
 * Maintains the last N utterances for AI context and a max-3 question queue.
 */
class InterviewTranscriptBuffer {
  constructor({ maxUtterances = 15, maxMemoryEntries = 5 } = {}) {
    this._utterances = []; // [{ id, text, timestamp }]
    this._questions = [];  // [{ questionId, questionText, timestamp }] — max 3
    this.maxUtterances = maxUtterances;

    // Conversation memory: sliding window of Q&A entries with async summarization
    this._memory = []; // [{ q, a, summary, summarizing }]
    this._maxMemoryEntries = maxMemoryEntries;
    this._summarizeFn = null; // injected via setSummarizeFn()
  }

  /**
   * Inject the summarization function (from ai.service).
   * Signature: async (question, answer) => string
   */
  setSummarizeFn(fn) {
    this._summarizeFn = fn;
  }

  /**
   * Store a Q&A pair and trigger async summarization.
   * Called right after question_answer_complete.
   */
  addQAPair(question, answer) {
    const entry = { q: question, a: answer, summary: null, summarizing: false };
    this._memory.push(entry);

    // Drop oldest if over cap
    if (this._memory.length > this._maxMemoryEntries) {
      this._memory.shift();
    }

    // Fire-and-forget summarization
    this._summarizeEntry(entry);
  }

  /**
   * Async summarize a single entry. Non-blocking — never delays AI answers.
   * On completion, replaces raw Q&A with compact summary.
   */
  async _summarizeEntry(entry) {
    if (!this._summarizeFn) return;
    entry.summarizing = true;
    try {
      const summary = await this._summarizeFn(entry.q, entry.a);
      if (summary && summary.trim()) {
        entry.summary = summary.trim();
      }
    } catch (_) {
      // Summarization failed — raw Q&A stays as fallback
    } finally {
      entry.summarizing = false;
    }
  }

  /**
   * Build memory context string for prompt injection.
   * Uses summary if available, raw Q&A otherwise.
   */
  getMemoryContext() {
    if (this._memory.length === 0) return '';

    const lines = this._memory.map((entry) => {
      if (entry.summary) {
        return `- ${entry.summary}`;
      }
      return `- Q: ${entry.q}\n  A: ${entry.a}`;
    });

    return `## Conversation History\n${lines.join('\n')}`;
  }

  addUtterance(text) {
    const id = `u-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    this._utterances.push({ id, text, timestamp: Date.now() });
    if (this._utterances.length > this.maxUtterances) {
      this._utterances.shift();
    }
    return id;
  }

  getTranscriptContext() {
    return this._utterances.map((u) => u.text).join('\n');
  }

  getLastQuestion() {
    if (this._questions.length === 0) return null;
    return this._questions[this._questions.length - 1];
  }

  addQuestion(questionId, questionText) {
    if (this._questions.length >= 3) {
      this._questions.shift();
    }
    this._questions.push({ questionId, questionText, timestamp: Date.now() });
  }

  mergeQuestion(questionId, newText) {
    const entry = this._questions.find((q) => q.questionId === questionId);
    if (entry) {
      entry.questionText = newText;
      entry.timestamp = Date.now();
    }
  }

  getQuestions() {
    return [...this._questions];
  }
}

export default InterviewTranscriptBuffer;
