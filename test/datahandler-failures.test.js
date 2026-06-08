/**
 * Issue #7 — DataHandler failure isolation tests.
 *
 * Verifies that session persistence failures NEVER block the live
 * answer flow — question_answer_token and question_answer_complete
 * must fire even when every session write throws.
 *
 * Uses a mock Socket.IO-like namespace and a mock sessionService.
 * aiService.answerInterviewQuestion is replaced with a controlled
 * async generator so no network calls are made.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import DataHandler from '../src/sockets/dataHandler.js';
import aiService from '../src/services/ai.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────

class MockSessionService {
  constructor() {
    this.failOnWrite = false;
    this.activeSessionId = null;
    this.eventCalls = [];        // every appendEvent call recorded
  }

  setFailureMode(fail) { this.failOnWrite = fail; }

  ensureActiveSession() {
    if (this.failOnWrite) throw new Error('Simulated: ensureActiveSession failed');
    const session = { id: 'mock-session-' + Date.now(), status: 'active' };
    this.activeSessionId = session.id;
    return session;
  }

  appendEvent(sessionId, eventType, payload) {
    this.eventCalls.push({ sessionId, eventType, payload });
    if (this.failOnWrite) throw new Error('Simulated: appendEvent failed');
    return { id: 'evt-' + Date.now(), session_id: sessionId, event_type: eventType };
  }

  appendTurn(sessionId, turnInput) {
    if (this.failOnWrite) throw new Error('Simulated: appendTurn failed');
    return { id: 'turn-' + Date.now(), session_id: sessionId, ...turnInput };
  }
}

// Controlled AI answer stream — no API calls, deterministic output.
// Produces tokens that trigger the "Q: …\nA:" extraction in
// _streamInterviewAnswer so both the extraction and answer paths are exercised.
async function* mockAiAnswerStream() {
  const tokens = [
    'Q: What is Redis?\nA: ',
    'Redis is an in-memory ',
    'data store.',
  ];
  for (const t of tokens) {
    yield { token: t, provider: 'test-provider', model: 'test-model' };
  }
  // No usage marker — not needed for these tests
}

// ── Test setup / teardown ─────────────────────────────────────────────

/**
 * Create a minimal Socket.IO-like mock so DataHandler can run without
 * real network I/O. No ports, no HTTP — entirely in-process.
 */
function createMockIo() {
  const events = [];
  const listeners = new Map();
  const mockNamespace = {
    emit(event, ...args) {
      events.push({ event, data: args[0] });
      const handlers = listeners.get(event) || [];
      handlers.forEach(h => h(...args));
      return this;
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return this;
    },
    sockets: new Map(),
  };

  const io = {
    of() { return mockNamespace; },
    close() { /* no-op mock */ },
  };

  return { io, namespace: mockNamespace, events };
}

async function setupTest(failureMode = false) {
  const { io, namespace, events } = createMockIo();

  const mockSession = new MockSessionService();
  mockSession.setFailureMode(failureMode);

  const dataHandler = new DataHandler(io, { sessionService: mockSession });

  // Replace AI service — save original for restore
  const origAiAnswer = aiService.answerInterviewQuestion;
  aiService.answerInterviewQuestion = () => mockAiAnswerStream();

  return {
    io, dataHandler, namespace, capturedEvents: events, mockSession,
    close: async () => {
      aiService.answerInterviewQuestion = origAiAnswer;
      // Clean up DataHandler timers to allow process exit
      if (dataHandler._cleanupTimer) {
        clearInterval(dataHandler._cleanupTimer);
        dataHandler._cleanupTimer = null;
      }
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

test('handleSttFinal emits question_answer_complete despite all session write failures', async (t) => {
  const env = await setupTest(true /* all writes fail */);
  try {
    await env.dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: 'What is Redis?' },
    );

    const evNames = env.capturedEvents.map(e => e.event);

    // Core contract: session failures must NOT block these events
    assert.ok(evNames.includes('interviewer_question'),
      'must emit interviewer_question');
    assert.ok(evNames.includes('question_answer_started'),
      'must emit question_answer_started');
    assert.ok(evNames.includes('question_answer_token'),
      'must emit at least one question_answer_token');
    assert.ok(evNames.includes('question_answer_complete'),
      'must emit question_answer_complete');

    // Verify the complete event has a response
    const complete = env.capturedEvents.find(e => e.event === 'question_answer_complete');
    assert.ok(complete.data.questionId, 'complete event must have questionId');
    assert.ok(complete.data.response, 'complete event must have response text');
    assert.ok(complete.data.response.includes('Redis'),
      `response should contain "Redis", got: ${complete.data.response}`);
  } finally {
    await env.close();
  }
});

test('handleSttFinal emits question_answer_token tokens despite session write failures', async (t) => {
  const env = await setupTest(true /* all writes fail */);
  try {
    await env.dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: 'What is Redis?' },
    );

    const tokens = env.capturedEvents.filter(e => e.event === 'question_answer_token');
    assert.ok(tokens.length > 0, 'must have at least one answer token');

    // All token events should carry questionId
    tokens.forEach(t => {
      assert.ok(t.data.questionId, 'each token must carry questionId');
    });
  } finally {
    await env.close();
  }
});

test('handleSttFinal emits question_answer_complete when AI stream fails (AI error isolation)', async (t) => {
  const env = await setupTest(false /* session writes OK */);
  try {
    // Replace mock with a failing one
    const origAiAnswer = aiService.answerInterviewQuestion;
    aiService.answerInterviewQuestion = () => { throw new Error('Simulated AI failure'); };

    try {
      await env.dataHandler.handleSttFinal(
        { id: 'test-socket' },
        { text: 'What is Node.js?' },
      );
    } catch (_) {
      // handler should not throw either — errors are caught internally
      assert.fail('handleSttFinal should not throw; errors are caught internally');
    } finally {
      aiService.answerInterviewQuestion = origAiAnswer;
    }

    const evNames = env.capturedEvents.map(e => e.event);

    // Even on AI failure, question_answer_complete must fire
    assert.ok(evNames.includes('question_answer_complete'),
      'must emit question_answer_complete even on AI failure');
    assert.ok(evNames.includes('interviewer_question'),
      'must emit interviewer_question');
  } finally {
    await env.close();
  }
});

test('handleSttFinal completes with healthy session service (sanity)', async (t) => {
  const env = await setupTest(false /* no failures */);
  try {
    await env.dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: 'What is Redis?' },
    );

    const evNames = env.capturedEvents.map(e => e.event);
    assert.ok(evNames.includes('question_answer_complete'));
    assert.ok(evNames.includes('question_answer_token'));

    // With a healthy session, appendEvent should have been called at least
    // for stt_final_received
    const sttFinalCalls = env.mockSession.eventCalls.filter(
      c => c.eventType === 'stt_final_received'
    );
    assert.equal(sttFinalCalls.length, 1,
      'stt_final_received event must be recorded');
  } finally {
    await env.close();
  }
});

test('handleSttFinal records event calls correctly when session is healthy', async (t) => {
  const env = await setupTest(false);
  try {
    await env.dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: 'Explain Redis caching' },
    );

    // Verify the sequence of appendEvent calls
    const eventTypes = env.mockSession.eventCalls.map(c => c.eventType);
    assert.ok(eventTypes.includes('stt_final_received'));
    assert.ok(eventTypes.includes('ai_answer_started'));
    assert.ok(eventTypes.includes('ai_answer_completed'),
      'ai_answer_completed must be recorded when answer succeeds');
  } finally {
    await env.close();
  }
});

test('handleSttFinal records ai_answer_failed when AI answer throws', async (t) => {
  const env = await setupTest(false);
  try {
    const origAiAnswer = aiService.answerInterviewQuestion;
    aiService.answerInterviewQuestion = () => { throw new Error('Simulated AI failure'); };

    await env.dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: 'Will this fail?' },
    );

    aiService.answerInterviewQuestion = origAiAnswer;

    // ai_answer_failed must be recorded
    const failedCalls = env.mockSession.eventCalls.filter(
      c => c.eventType === 'ai_answer_failed'
    );
    assert.equal(failedCalls.length, 1,
      'ai_answer_failed event must be recorded');
    assert.ok(failedCalls[0].payload.error,
      'error detail must be in the payload');
  } finally {
    await env.close();
  }
});

test('handleSttFinal does not emit interviewer_question for empty text', async (t) => {
  const env = await setupTest(false);
  try {
    await env.dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: '', uid: 'empty-test' },
    );

    // Empty text should early-return, producing no events
    assert.equal(env.capturedEvents.length, 0,
      'empty text must produce no events');
  } finally {
    await env.close();
  }
});
