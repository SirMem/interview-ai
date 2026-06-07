import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SOLVEWATCH_DB_PATH = ':memory:';

const { SessionService, SessionValidationError } = await import('../src/services/session.service.js');

function createService() {
  return new SessionService({ dbPath: ':memory:' });
}

test('SessionService initializes the first-version schema', () => {
  const service = createService();
  try {
    const objects = service.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type IN ('table', 'index')
    `).all().map(row => row.name);

    assert.ok(objects.includes('sessions'));
    assert.ok(objects.includes('conversation_turns'));
    assert.ok(objects.includes('session_events'));
    assert.ok(objects.includes('conversation_turns_fts'));
    assert.ok(objects.includes('idx_sessions_updated_at'));
  } finally {
    service.close();
  }
});

test('SessionService creates a session with default values', () => {
  const service = createService();
  try {
    const session = service.createSession();

    assert.equal(session.type, 'live');
    assert.match(session.title, /^Live Interview - \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(session.status, 'active');
    assert.equal(session.company, '');
    assert.equal(session.role, '');
    assert.deepEqual(session.metadata, {});
    assert.ok(session.id);
    assert.ok(session.created_at);
    assert.equal(service.activeSessionId, session.id);
  } finally {
    service.close();
  }
});

test('SessionService creates a session with custom fields', () => {
  const service = createService();
  try {
    const session = service.createSession({
      title: 'Backend mock interview',
      type: 'mock',
      company: 'ExampleCorp',
      role: 'Backend Engineer',
      metadata: { source: 'test' },
    });

    assert.equal(session.title, 'Backend mock interview');
    assert.equal(session.type, 'mock');
    assert.equal(session.company, 'ExampleCorp');
    assert.equal(session.role, 'Backend Engineer');
    assert.deepEqual(session.metadata, { source: 'test' });
  } finally {
    service.close();
  }
});

test('SessionService lists sessions newest first with pagination', () => {
  const service = createService();
  try {
    const first = service.createSession({ title: 'First' });
    const second = service.createSession({ title: 'Second' });
    const third = service.createSession({ title: 'Third' });

    const pageOne = service.listSessions({ limit: 2, offset: 0 });
    assert.equal(pageOne.pagination.total, 3);
    assert.equal(pageOne.sessions.length, 2);
    assert.deepEqual(pageOne.sessions.map(s => s.id), [third.id, second.id]);

    const pageTwo = service.listSessions({ limit: 2, offset: 2 });
    assert.equal(pageTwo.sessions.length, 1);
    assert.equal(pageTwo.sessions[0].id, first.id);
  } finally {
    service.close();
  }
});

test('SessionService fetches a session by id and returns null for missing ids', () => {
  const service = createService();
  try {
    const created = service.createSession({ title: 'Find me' });
    const fetched = service.getSession(created.id);

    assert.equal(fetched.id, created.id);
    assert.equal(fetched.title, 'Find me');
    assert.equal(service.getSession('missing-session'), null);
  } finally {
    service.close();
  }
});

test('SessionService validates invalid input', () => {
  const service = createService();
  try {
    assert.throws(() => service.createSession({ title: 123 }), SessionValidationError);
    assert.throws(() => service.createSession({ type: 'invalid' }), SessionValidationError);
    assert.throws(() => service.createSession({ metadata: [] }), SessionValidationError);
    assert.throws(() => service.listSessions({ limit: 0 }), SessionValidationError);
    assert.throws(() => service.listSessions({ offset: -1 }), SessionValidationError);
  } finally {
    service.close();
  }
});

test('SessionService creates a usable FTS5 table scaffold', () => {
  const service = createService();
  try {
    service.db.prepare(`
      INSERT INTO conversation_turns_fts(turn_id, session_id, cleaned_question, answer, raw_transcript)
      VALUES (?, ?, ?, ?, ?)
    `).run('turn-1', 'session-1', 'Redis cache question', 'Redis answer', 'raw Redis transcript');

    const result = service.db.prepare(`
      SELECT turn_id, session_id FROM conversation_turns_fts
      WHERE conversation_turns_fts MATCH ?
    `).get('Redis');

    assert.equal(result.turn_id, 'turn-1');
    assert.equal(result.session_id, 'session-1');
  } finally {
    service.close();
  }
});
