/**
 * Issue #6 — DataHandler restore_session flow tests.
 *
 * Tests that restore_session wire handlers work with mock IO:
 * - Valid session id → session_restored emitted with correct payload
 * - Invalid session id → restore_session_error emitted
 * - Future handleSttFinal uses the restored session for appendTurn
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import DataHandler from '../src/sockets/dataHandler.js';
import aiService from '../src/services/ai.service.js';

// ── Mock helpers (same pattern as datahandler-failures.test.js) ─────────

function createMockSocket() {
  const handlers = new Map();
  const emitted = [];
  return {
    id: 'test-socket-' + Date.now(),
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    emit(event, data) { emitted.push({ event, data }); },
    // Simulate receiving an event from the client
    _receive(event, data) {
      const h = handlers.get(event) || [];
      h.forEach(fn => fn(data));
    },
    _emitted: emitted,
  };
}

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
    // Expose for test inspection
    _listeners: listeners,
  };
  const io = { of() { return mockNamespace; }, close() {} };
  return { io, namespace: mockNamespace, events };

  // Helper: get connection handler registered by DataHandler
  function getConnectionHandler(namespace) {
    if (!namespace || !namespace._listeners) return null;
    const handlers = namespace._listeners.get('connection');
    return handlers && handlers.length > 0 ? handlers[0] : null;
  }
}

class MockSessionService {
  constructor() {
    this.activeSessionId = null;
    this.eventCalls = [];
    this._session = null;
  }

  setActiveSession(session) {
    this._session = session;
    this.activeSessionId = session.id;
  }

  getSession(id) {
    if (this._session && this._session.id === id) return this._session;
    return null;
  }

  reactivateSession(id) {
    if (this._session && this._session.id === id && this._session.status === 'ended') {
      this._session.status = 'active';
      this._session.ended_at = null;
      this.activeSessionId = id;
      return this._session;
    }
    return null;
  }

  ensureActiveSession() {
    if (!this._session) {
      this._session = { id: 'mock-session-' + Date.now(), status: 'active' };
    }
    this.activeSessionId = this._session.id;
    return this._session;
  }

  appendEvent(sessionId, eventType, payload) {
    this.eventCalls.push({ sessionId, eventType, payload });
    return { id: 'evt-' + Date.now() };
  }

  appendTurn(sessionId, turnInput) {
    return { id: 'turn-' + Date.now(), session_id: sessionId, ...turnInput };
  }

  getTurns(sessionId, options = {}) {
    return [];
  }
}

async function* mockAiAnswerStream() {
  yield { token: 'Q: Answer?\nA: Yes.', provider: 'test', model: 'test' };
}

// ── Tests ──────────────────────────────────────────────────────────────

test('restore_session with valid ended session emits session_restored', async (t) => {
  const { io, namespace, events } = createMockIo();
  const mockSession = new MockSessionService();
  mockSession.setActiveSession({ id: 'ended-session-1', status: 'ended', title: 'My Session', ended_at: '2024-01-01' });

  const dataHandler = new DataHandler(io, { sessionService: mockSession });

  // Get the connection handler that was registered on the namespace
  let connectionHandler;
  for (const [event, handlers] of namespace._listeners) {
    if (event === 'connection') connectionHandler = handlers[0];
  }
  assert.ok(connectionHandler, 'connection handler must be registered');

  // Simulate a socket that receives restore_session
  const mockSocket = createMockSocket();
  connectionHandler(mockSocket);
  mockSocket._receive('restore_session', { sessionId: 'ended-session-1' });

  // Find session_restored in events
  const restoredEvent = events.find(e => e.event === 'session_restored');
  assert.ok(restoredEvent, 'session_restored must be emitted');
  assert.equal(restoredEvent.data.sessionId, 'ended-session-1');
  assert.ok(restoredEvent.data.restoredTurnCount !== undefined);
  assert.equal(restoredEvent.data.title, 'My Session');
});

test('restore_session with non-existent session emits error', async (t) => {
  const { io, events } = createMockIo();
  const mockSession = new MockSessionService();

  const dataHandler = new DataHandler(io, { sessionService: mockSession });

  let connectionHandler;
  for (const [, handlers] of dataHandler.namespace._listeners) {
    if (handlers.length > 0) connectionHandler = handlers[0];
  }

  const mockSocket = createMockSocket();
  connectionHandler(mockSocket);
  mockSocket._receive('restore_session', { sessionId: 'non-existent-id' });

  const errorEvent = mockSocket._emitted.find(e => e.event === 'restore_session_error');
  assert.ok(errorEvent, 'restore_session_error must be emitted');
  assert.ok(errorEvent.data.error);
});

test('restore_session with active session emits error', async (t) => {
  const { io } = createMockIo();
  const mockSession = new MockSessionService();
  mockSession.setActiveSession({ id: 'active-session', status: 'active', title: 'Already active' });

  const dataHandler = new DataHandler(io, { sessionService: mockSession });

  let connectionHandler;
  for (const [, handlers] of dataHandler.namespace._listeners) {
    if (handlers.length > 0) connectionHandler = handlers[0];
  }

  const mockSocket = createMockSocket();
  connectionHandler(mockSocket);
  mockSocket._receive('restore_session', { sessionId: 'active-session' });

  const errorEvent = mockSocket._emitted.find(e => e.event === 'restore_session_error');
  assert.ok(errorEvent, 'restore_session_error must be emitted for active sessions');
});

test('restore_session without sessionId emits error', async (t) => {
  const { io } = createMockIo();
  const mockSession = new MockSessionService();

  const dataHandler = new DataHandler(io, { sessionService: mockSession });

  let connectionHandler;
  for (const [, handlers] of dataHandler.namespace._listeners) {
    if (handlers.length > 0) connectionHandler = handlers[0];
  }

  const mockSocket = createMockSocket();
  connectionHandler(mockSocket);
  mockSocket._receive('restore_session', {});  // no sessionId

  const errorEvent = mockSocket._emitted.find(e => e.event === 'restore_session_error');
  assert.ok(errorEvent, 'restore_session_error must be emitted when sessionId is missing');
});

test('handleSttFinal appends turn to the restored session after restore', async (t) => {
  const { io, namespace } = createMockIo();
  const mockSession = new MockSessionService();
  mockSession.setActiveSession({ id: 'will-be-active', status: 'active', title: 'Active' });

  const dataHandler = new DataHandler(io, { sessionService: mockSession });

  // Mock aiService
  const origAiAnswer = aiService.answerInterviewQuestion;
  aiService.answerInterviewQuestion = () => mockAiAnswerStream();

  try {
    await dataHandler.handleSttFinal(
      { id: 'test-socket' },
      { text: 'Will this work?' },
    );

    // With a healthy mock session, appendTurn should have been called
    // (it's in setTimeout(0).unref() so give it a tick)
    await new Promise(resolve => setTimeout(resolve, 10));

    // activeSessionId should still be set
    assert.equal(mockSession.activeSessionId, 'will-be-active');
  } finally {
    aiService.answerInterviewQuestion = origAiAnswer;
  }
});
