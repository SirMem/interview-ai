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

// ── ensureActiveSession ──────────────────────────────────────────────

test('ensureActiveSession auto-creates a session when none exists', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    assert.ok(session.id);
    assert.equal(session.status, 'active');
    assert.equal(session.type, 'live');
    assert.match(session.title, /^Live Interview - \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(service.activeSessionId, session.id);
  } finally {
    service.close();
  }
});

test('ensureActiveSession returns existing active session', () => {
  const service = createService();
  try {
    const first = service.createSession({ title: 'My Session' });
    const second = service.ensureActiveSession();

    assert.equal(second.id, first.id);
    assert.equal(second.title, 'My Session');
  } finally {
    service.close();
  }
});

test('ensureActiveSession auto-creates new session when tracked session is no longer active', () => {
  const service = createService();
  try {
    const first = service.createSession({ title: 'First' });
    assert.equal(service.activeSessionId, first.id);

    // Simulate external end via direct SQL
    service.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('ended', first.id);

    const second = service.ensureActiveSession();
    assert.notEqual(second.id, first.id);
    assert.equal(second.status, 'active');
  } finally {
    service.close();
  }
});

// ── appendTurn ───────────────────────────────────────────────────────

test('appendTurn writes a turn and returns it with correct fields', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    const turn = service.appendTurn(session.id, {
      raw_transcript: 'What is Redis?',
      cleaned_question: 'Explain Redis caching',
      answer: 'Redis is an in-memory data store.',
      provider: 'openai',
      model: 'gpt-4o-mini',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.002,
      latency_ms: 1200,
    });

    assert.ok(turn.id);
    assert.equal(turn.session_id, session.id);
    assert.equal(turn.turn_index, 0);
    assert.equal(turn.raw_transcript, 'What is Redis?');
    assert.equal(turn.cleaned_question, 'Explain Redis caching');
    assert.equal(turn.answer, 'Redis is an in-memory data store.');
    assert.equal(turn.provider, 'openai');
    assert.equal(turn.model, 'gpt-4o-mini');
    assert.equal(turn.input_tokens, 100);
    assert.equal(turn.output_tokens, 50);
    assert.equal(turn.cost_usd, 0.002);
    assert.equal(turn.latency_ms, 1200);
    assert.ok(turn.created_at);
  } finally {
    service.close();
  }
});

test('appendTurn uses raw_transcript as cleaned_question fallback', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    const turn = service.appendTurn(session.id, {
      raw_transcript: 'user raw speech here',
      answer: 'Some answer.',
    });

    assert.equal(turn.raw_transcript, 'user raw speech here');
    // cleaned_question should fall back to raw_transcript
    assert.equal(turn.cleaned_question, 'user raw speech here');
  } finally {
    service.close();
  }
});

test('appendTurn increments turn_index for each successive turn', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    const turn0 = service.appendTurn(session.id, {
      raw_transcript: 'First question',
      answer: 'First answer',
    });
    assert.equal(turn0.turn_index, 0);

    const turn1 = service.appendTurn(session.id, {
      raw_transcript: 'Second question',
      answer: 'Second answer',
    });
    assert.equal(turn1.turn_index, 1);

    const turn2 = service.appendTurn(session.id, {
      raw_transcript: 'Third question',
      answer: 'Third answer',
    });
    assert.equal(turn2.turn_index, 2);
  } finally {
    service.close();
  }
});

test('appendTurn throws for non-existent session', () => {
  const service = createService();
  try {
    assert.throws(
      () => service.appendTurn('nonexistent-id', { raw_transcript: 'test', answer: 'test' }),
      /Session "nonexistent-id" not found/,
    );
  } finally {
    service.close();
  }
});

test('appendTurn throws for non-active session', () => {
  const service = createService();
  try {
    const session = service.createSession({});
    // End the session via direct SQL
    service.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('ended', session.id);

    assert.throws(
      () => service.appendTurn(session.id, { raw_transcript: 'test', answer: 'test' }),
      /is not active/,
    );
  } finally {
    service.close();
  }
});

test('appendTurn throws when empty input is provided (no transcript, no answer)', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    assert.throws(
      () => service.appendTurn(session.id, {}),
      /At least one of/,
    );
  } finally {
    service.close();
  }
});

// ── getTurns ─────────────────────────────────────────────────────────

test('getTurns returns empty array for session with no turns', () => {
  const service = createService();
  try {
    const session = service.createSession({});
    const turns = service.getTurns(session.id);
    assert.deepEqual(turns, []);
  } finally {
    service.close();
  }
});

test('getTurns returns turns ordered by turn_index', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    service.appendTurn(session.id, { raw_transcript: 'Q zero', answer: 'A zero' });
    service.appendTurn(session.id, { raw_transcript: 'Q one', answer: 'A one' });
    service.appendTurn(session.id, { raw_transcript: 'Q two', answer: 'A two' });

    const turns = service.getTurns(session.id);
    assert.equal(turns.length, 3);
    assert.equal(turns[0].turn_index, 0);
    assert.equal(turns[1].turn_index, 1);
    assert.equal(turns[2].turn_index, 2);
    assert.equal(turns[0].raw_transcript, 'Q zero');
    assert.equal(turns[1].raw_transcript, 'Q one');
    assert.equal(turns[2].raw_transcript, 'Q two');
  } finally {
    service.close();
  }
});

test('getTurns returns only turns for the specified session, not others', () => {
  const service = createService();
  try {
    const s1 = service.createSession({ title: 'S1' });
    const s2 = service.createSession({ title: 'S2' });

    service.appendTurn(s1.id, { raw_transcript: 'Q1', answer: 'A1' });
    service.appendTurn(s1.id, { raw_transcript: 'Q2', answer: 'A2' });
    service.appendTurn(s2.id, { raw_transcript: 'Q3', answer: 'A3' });

    const turns1 = service.getTurns(s1.id);
    assert.equal(turns1.length, 2);
    assert.equal(turns1[0].raw_transcript, 'Q1');
    assert.equal(turns1[1].raw_transcript, 'Q2');

    const turns2 = service.getTurns(s2.id);
    assert.equal(turns2.length, 1);
    assert.equal(turns2[0].raw_transcript, 'Q3');
  } finally {
    service.close();
  }
});

test('appendTurn syncs FTS5 table — turn is searchable', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    service.appendTurn(session.id, {
      raw_transcript: 'How does cache work in Redis?',
      cleaned_question: 'Explain Redis caching mechanism',
      answer: 'Redis uses an in-memory key-value store.',
    });

    const result = service.db.prepare(`
      SELECT turn_id FROM conversation_turns_fts
      WHERE conversation_turns_fts MATCH ?
    `).get('Redis');

    assert.ok(result);
    assert.ok(result.turn_id);
  } finally {
    service.close();
  }
});
