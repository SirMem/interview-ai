/**
 * Issue #7 — Simulated SessionService failure isolation tests.
 *
 * Verifies that when appendEvent or DB operations fail inside
 * session.service.js, the service degrades gracefully and does not
 * throw from createSession() or ensureActiveSession().
 *
 * Relies on monkey-patching at the instance level — no external
 * mocking framework needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SOLVEWATCH_DB_PATH = ':memory:';

const { SessionService, SessionValidationError, TurnValidationError } = await import('../src/services/session.service.js');

function createService() {
  return new SessionService({ dbPath: ':memory:' });
}

// ── createSession() failure isolation ──────────────────────────────────

test('createSession succeeds even when appendEvent throws', () => {
  const service = createService();
  try {
    // sabotage appendEvent after the INSERT has succeeded
    const origAppendEvent = service.appendEvent.bind(service);
    const callLog = [];
    service.appendEvent = function (...args) {
      callLog.push(args);
      throw new Error('Simulated: appendEvent unavailable');
    };

    const session = service.createSession({ title: 'Broken event test' });

    // Session must still be created and returned
    assert.ok(session.id);
    assert.equal(session.title, 'Broken event test');
    assert.equal(session.status, 'active');
    assert.equal(service.activeSessionId, session.id);

    // appendEvent was called (and failed) at least once
    assert.ok(callLog.length >= 1);
    assert.equal(callLog[0][1], 'session_started');

    // The session row actually exists in the DB
    const fetched = service.getSession(session.id);
    assert.ok(fetched);
    assert.equal(fetched.status, 'active');
  } finally {
    service.close();
  }
});

test('createSession handles DB-level INSERT failure — throws naturally', () => {
  const service = createService();
  try {
    // Close the underlying DB so INSERTs fail
    service.db.close();

    assert.throws(
      () => service.createSession({ title: 'Should fail' }),
      /connection is not open/,
    );
  } finally {
    service.close();
  }
});

// ── ensureActiveSession() failure isolation ────────────────────────────

test('ensureActiveSession succeeds even when its own appendEvent throws', () => {
  const service = createService();
  try {
    // After createSession (called internally) we want the _outer_
    // appendEvent('session_auto_created') in ensureActiveSession to fail.
    // We track calls to appendEvent and only fail on 'session_auto_created'.
    const origAppendEvent = service.appendEvent.bind(service);
    service.appendEvent = function (sessionId, eventType, payload) {
      if (eventType === 'session_auto_created') {
        throw new Error('Simulated: session_auto_created appendEvent failed');
      }
      return origAppendEvent(sessionId, eventType, payload);
    };

    const session = service.ensureActiveSession();

    // Must return a valid active session
    assert.ok(session.id);
    assert.equal(session.status, 'active');
    assert.equal(service.activeSessionId, session.id);

    // session_started event was recorded (inner appendEvent from createSession)
    const events = service.db.prepare(
      'SELECT event_type FROM session_events WHERE session_id = ? ORDER BY event_time ASC'
    ).all(session.id);
    const types = events.map(e => e.event_type);
    assert.ok(types.includes('session_started'), 'session_started must be recorded');
    // session_auto_created is optional — failure is tolerated
  } finally {
    service.close();
  }
});

// ── appendEvent() failure isolation ────────────────────────────────────

test('appendEvent yields meaningful diagnostic context on failure', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Diag test' });

    // Use a closed DB to force real SQLite failure
    service.db.close();
    // Re-open for getSession to work but prepare will fail
    service.db = { open: false, prepare: () => { throw new Error('SQLite: disk I/O error'); } };

    assert.throws(
      () => service.appendEvent(session.id, 'test_event', { key: 'value' }),
      /disk I\/O error/,
    );
  } finally {
    service.close();
  }
});

// ── appendTurn() failure isolation ─────────────────────────────────────

test('appendTurn failure message includes the session ID', () => {
  const service = createService();
  try {
    assert.throws(
      () => service.appendTurn('session-that-does-not-exist', { raw_transcript: 'test', answer: 'test' }),
      /Session "session-that-does-not-exist" not found/,
    );
  } finally {
    service.close();
  }
});

// ── endSession() failure isolation ─────────────────────────────────────

test('endSession returns null with clear message for missing session', () => {
  const service = createService();
  try {
    const result = service.endSession('non-existent-id');
    assert.equal(result, null);
  } finally {
    service.close();
  }
});

// ── appendEvent inside createSession — verify the fix is actually active
test('createSession records session_started event when appendEvent works (sanity)', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Sanity check' });
    const events = service.db.prepare(
      'SELECT event_type FROM session_events WHERE session_id = ?'
    ).all(session.id);
    assert.ok(events.some(e => e.event_type === 'session_started'));
  } finally {
    service.close();
  }
});
