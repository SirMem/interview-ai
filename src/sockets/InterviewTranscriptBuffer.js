/**
 * Rolling buffer of interviewer utterances and detected question queue.
 * Maintains the last N utterances for AI context and a max-3 question queue.
 */
class InterviewTranscriptBuffer {
  constructor({ maxUtterances = 15 } = {}) {
    this._utterances = []; // [{ id, text, timestamp }]
    this._questions = [];  // [{ questionId, questionText, timestamp }] — max 3
    this.maxUtterances = maxUtterances;
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
