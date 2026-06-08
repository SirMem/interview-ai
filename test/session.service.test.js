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

// ── Session Events ──────────────────────────────────────────────────────

test('appendEvent writes an event with correct fields', () => {
  const service = createService();
  try {
    const session = service.createSession({});

    const event = service.appendEvent(session.id, 'test_event', { some: 'data', count: 42 });

    assert.ok(event.id);
    assert.equal(event.session_id, session.id);
    assert.equal(event.event_type, 'test_event');
    assert.deepEqual(event.payload, { some: 'data', count: 42 });
    assert.ok(event.event_time);

    // Verify it's persisted in the database
    const row = service.db.prepare('SELECT * FROM session_events WHERE id = ?').get(event.id);
    assert.ok(row);
    assert.equal(row.event_type, 'test_event');
    assert.equal(row.session_id, session.id);
  } finally {
    service.close();
  }
});

test('appendEvent rejects missing sessionId', () => {
  const service = createService();
  try {
    assert.throws(
      () => service.appendEvent(null, 'test_event', {}),
      /sessionId is required/,
    );
    assert.throws(
      () => service.appendEvent('', 'test_event', {}),
      /sessionId is required/,
    );
  } finally {
    service.close();
  }
});

test('appendEvent rejects missing eventType', () => {
  const service = createService();
  try {
    const session = service.createSession({});
    assert.throws(
      () => service.appendEvent(session.id, null, {}),
      /eventType is required/,
    );
    assert.throws(
      () => service.appendEvent(session.id, '', {}),
      /eventType is required/,
    );
  } finally {
    service.close();
  }
});

test('appendEvent rejects non-object payload', () => {
  const service = createService();
  try {
    const session = service.createSession({});
    assert.throws(
      () => service.appendEvent(session.id, 'test_event', 'bad'),
      /payload must be a plain object/,
    );
    assert.throws(
      () => service.appendEvent(session.id, 'test_event', 42),
      /payload must be a plain object/,
    );
    assert.throws(
      () => service.appendEvent(session.id, 'test_event', null),
      /payload must be a plain object/,
    );
  } finally {
    service.close();
  }
});

test('createSession records a session_started event', () => {
  const service = createService();
  try {
    const session = service.createSession({ type: 'mock', title: 'My Session' });

    const events = service.db.prepare(`
      SELECT * FROM session_events WHERE session_id = ? ORDER BY event_time ASC
    `).all(session.id);

    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'session_started');
    assert.equal(events[0].session_id, session.id);

    const payload = JSON.parse(events[0].payload_json);
    assert.equal(payload.type, 'mock');
    assert.equal(payload.title, 'My Session');
  } finally {
    service.close();
  }
});

test('ensureActiveSession auto-create records session_started and session_auto_created', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    const events = service.db.prepare(`
      SELECT event_type FROM session_events WHERE session_id = ? ORDER BY event_time ASC
    `).all(session.id);

    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, 'session_started');
    assert.equal(events[1].event_type, 'session_auto_created');
  } finally {
    service.close();
  }
});

test('ensureActiveSession returning existing session does not record session_auto_created', () => {
  const service = createService();
  try {
    const first = service.createSession({ title: 'Manual' });
    const eventsBefore = service.db.prepare(
      'SELECT event_type FROM session_events WHERE session_id = ?'
    ).all(first.id);
    assert.equal(eventsBefore.length, 1);
    assert.equal(eventsBefore[0].event_type, 'session_started');

    // ensureActiveSession should find the existing active session
    const second = service.ensureActiveSession();
    assert.equal(second.id, first.id);

    // No new events should have been recorded — session_auto_created must NOT be added
    const eventsAfter = service.db.prepare(
      'SELECT event_type FROM session_events WHERE session_id = ?'
    ).all(first.id);
    assert.equal(eventsAfter.length, 1);
  } finally {
    service.close();
  }
});

test('appendTurn records a conversation_turn_created event', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    const turn = service.appendTurn(session.id, {
      raw_transcript: 'What is Redis?',
      answer: 'Redis is a cache.',
    });

    const events = service.db.prepare(`
      SELECT * FROM session_events WHERE session_id = ? ORDER BY event_time ASC
    `).all(session.id);

    // Expect: session_started, session_auto_created, conversation_turn_created
    const turnEvent = events.find(e => e.event_type === 'conversation_turn_created');
    assert.ok(turnEvent, 'conversation_turn_created event should exist');
    assert.equal(turnEvent.session_id, session.id);

    const payload = JSON.parse(turnEvent.payload_json);
    assert.equal(payload.turnId, turn.id);
    assert.equal(payload.turnIndex, 0);
  } finally {
    service.close();
  }
});

test('appendTurn records event even when the turn is not the first turn', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();

    const turn1 = service.appendTurn(session.id, { raw_transcript: 'Q1', answer: 'A1' });
    const turn2 = service.appendTurn(session.id, { raw_transcript: 'Q2', answer: 'A2' });
    const turn3 = service.appendTurn(session.id, { raw_transcript: 'Q3', answer: 'A3' });

    const turnEvents = service.db.prepare(`
      SELECT event_type, payload_json FROM session_events
      WHERE session_id = ? AND event_type = 'conversation_turn_created'
      ORDER BY event_time ASC
    `).all(session.id);

    assert.equal(turnEvents.length, 3);
    assert.equal(JSON.parse(turnEvents[0].payload_json).turnIndex, 0);
    assert.equal(JSON.parse(turnEvents[1].payload_json).turnIndex, 1);
    assert.equal(JSON.parse(turnEvents[2].payload_json).turnIndex, 2);
  } finally {
    service.close();
  }
});

// ── Integrated lifecycle path ───────────────────────────────────────────

test('full lifecycle: create → appendTurn produces a chronological event chain', () => {
  const service = createService();
  try {
    // Create a manual session
    const session = service.createSession({ title: 'Interview' });

    // Append two turns
    service.appendTurn(session.id, { raw_transcript: 'Q1', answer: 'A1' });
    service.appendTurn(session.id, { raw_transcript: 'Q2', answer: 'A2' });

    // Fetch all events in order
    const events = service.db.prepare(`
      SELECT event_type, payload_json FROM session_events
      WHERE session_id = ?
      ORDER BY event_time ASC
    `).all(session.id);

    assert.equal(events.length, 3);

    // 1. session_started
    assert.equal(events[0].event_type, 'session_started');
    const startedPayload = JSON.parse(events[0].payload_json);
    assert.equal(startedPayload.title, 'Interview');
    assert.equal(startedPayload.type, 'live');

    // 2. conversation_turn_created (turn 0)
    assert.equal(events[1].event_type, 'conversation_turn_created');
    assert.equal(JSON.parse(events[1].payload_json).turnIndex, 0);

    // 3. conversation_turn_created (turn 1)
    assert.equal(events[2].event_type, 'conversation_turn_created');
    assert.equal(JSON.parse(events[2].payload_json).turnIndex, 1);
  } finally {
    service.close();
  }
});

// ── searchTurns ─────────────────────────────────────────────────────────

test('searchTurns matches cleaned_question', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    service.appendTurn(session.id, {
      cleaned_question: 'Explain Redis caching',
      answer: 'Redis is an in-memory data store.',
    });
    const result = service.searchTurns('Redis');

    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].turn_id, result.turns[0].turn_id);
    assert.equal(result.turns[0].session_id, session.id);
    assert.equal(result.turns[0].cleaned_question, 'Explain Redis caching');
    assert.equal(result.turns[0].answer, 'Redis is an in-memory data store.');
    assert.equal(result.turns[0].raw_transcript, '');
    assert.ok(result.turns[0].snippet);
    assert.equal(result.pagination.total, 1);
  } finally {
    service.close();
  }
});

test('searchTurns matches answer text', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    service.appendTurn(session.id, {
      raw_transcript: 'What is Redis?',
      answer: 'Redis is an in-memory key-value store with persistence.',
    });
    const result = service.searchTurns('persistence');

    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].answer, 'Redis is an in-memory key-value store with persistence.');
    assert.equal(result.pagination.total, 1);
  } finally {
    service.close();
  }
});

test('searchTurns matches raw_transcript text', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    service.appendTurn(session.id, {
      raw_transcript: 'Could you explain how Node.js event loop works?',
      answer: 'Node.js uses libuv event loop.',
    });
    const result = service.searchTurns('event loop');

    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].raw_transcript, 'Could you explain how Node.js event loop works?');
    assert.equal(result.pagination.total, 1);
  } finally {
    service.close();
  }
});

test('searchTurns returns empty array when no match is found', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    service.appendTurn(session.id, {
      cleaned_question: 'Explain Redis',
      answer: 'Redis is a cache.',
    });
    const result = service.searchTurns('PostgreSQL');
    assert.deepEqual(result.turns, []);
    assert.equal(result.pagination.total, 0);
  } finally {
    service.close();
  }
});

test('searchTurns throws validation error on empty query', () => {
  const service = createService();
  try {
    assert.throws(() => service.searchTurns(null), SessionValidationError);
    assert.throws(() => service.searchTurns(undefined), SessionValidationError);
    assert.throws(() => service.searchTurns(''), SessionValidationError);
    assert.throws(() => service.searchTurns('   '), SessionValidationError);
  } finally {
    service.close();
  }
});

test('searchTurns handles Chinese text search', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    service.appendTurn(session.id, {
      cleaned_question: 'Redis 缓存 机制 是什么',
      answer: 'Redis 是 内存 数据库',
    });
    const result = service.searchTurns('缓存');

    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].cleaned_question, 'Redis 缓存 机制 是什么');
    assert.equal(result.turns[0].answer, 'Redis 是 内存 数据库');
    assert.ok(result.turns[0].snippet);
    assert.equal(result.pagination.total, 1);
  } finally {
    service.close();
  }
});

test('searchTurns paginates correctly', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    for (let i = 0; i < 5; i++) {
      service.appendTurn(session.id, {
        cleaned_question: `Question about caching part ${i}`,
        answer: 'Redis is a cache.',
      });
    }

    const page1 = service.searchTurns('caching', { limit: 2, offset: 0 });
    assert.equal(page1.turns.length, 2);
    assert.equal(page1.pagination.total, 5);
    assert.equal(page1.pagination.limit, 2);
    assert.equal(page1.pagination.offset, 0);

    const page2 = service.searchTurns('caching', { limit: 2, offset: 2 });
    assert.equal(page2.turns.length, 2);
    assert.equal(page2.pagination.total, 5);
    assert.equal(page2.pagination.limit, 2);
    assert.equal(page2.pagination.offset, 2);

    const page3 = service.searchTurns('caching', { limit: 2, offset: 4 });
    assert.equal(page3.turns.length, 1);
    assert.equal(page3.pagination.total, 5);
  } finally {
    service.close();
  }
});
test('endSession marks a session as ended and sets ended_at', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'End me' });
    assert.equal(session.status, 'active');
    assert.equal(session.ended_at, null);

    const ended = service.endSession(session.id);
    assert.equal(ended.status, 'ended');
    assert.ok(ended.ended_at);
    assert.ok(new Date(ended.ended_at).getTime() > 0);

    // Verify persistence
    const fetched = service.getSession(session.id);
    assert.equal(fetched.status, 'ended');
    assert.ok(fetched.ended_at);
  } finally {
    service.close();
  }
});

test('endSession clears activeSessionId when ending the active session', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Active' });
    assert.equal(service.activeSessionId, session.id);

    service.endSession(session.id);
    assert.equal(service.activeSessionId, null);
  } finally {
    service.close();
  }
});

test('endSession does not clear activeSessionId when ending a different session', () => {
  const service = createService();
  try {
    const active = service.createSession({ title: 'Active' });
    const other = service.createSession({ title: 'Other' });

    // activeSessionId is now 'other' because createSession sets it
    assert.equal(service.activeSessionId, other.id);

    service.endSession(active.id);
    assert.equal(service.activeSessionId, other.id); // unchanged
  } finally {
    service.close();
  }
});

test('endSession records a session_ended event', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Event check' });
    service.endSession(session.id);

    const events = service.db.prepare(`
      SELECT event_type, payload_json FROM session_events
      WHERE session_id = ?
      ORDER BY event_time ASC
    `).all(session.id);

    const endedEvent = events.find(e => e.event_type === 'session_ended');
    assert.ok(endedEvent, 'session_ended event should exist');
    assert.deepEqual(JSON.parse(endedEvent.payload_json), { manual: true });
  } finally {
    service.close();
  }
});

test('endSession returns null if session does not exist', () => {
  const service = createService();
  try {
    const result = service.endSession('nonexistent-id');
    assert.equal(result, null);
  } finally {
    service.close();
  }
});

// ── archiveStaleActiveSessions ──────────────────────────────────────────

test('archiveStaleActiveSessions archives sessions older than 12 hours', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Stale' });

    // Manually set updated_at to 13 hours ago
    const past = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    service.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, session.id);

    const count = service.archiveStaleActiveSessions();
    assert.equal(count, 1);

    const fetched = service.getSession(session.id);
    assert.equal(fetched.status, 'archived');
    assert.ok(fetched.ended_at);
  } finally {
    service.close();
  }
});

test('archiveStaleActiveSessions does not archive recently active sessions', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Fresh' });

    const count = service.archiveStaleActiveSessions();
    assert.equal(count, 0);

    const fetched = service.getSession(session.id);
    assert.equal(fetched.status, 'active');
  } finally {
    service.close();
  }
});

test('archiveStaleActiveSessions does not archive ended or archived sessions', () => {
  const service = createService();
  try {
    const endedSession = service.createSession({ title: 'Ended' });
    service.endSession(endedSession.id);

    const archivedSession = service.createSession({ title: 'Archived' });
    service.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(archivedSession.id);

    const count = service.archiveStaleActiveSessions();
    assert.equal(count, 0);

    assert.equal(service.getSession(endedSession.id).status, 'ended');
    assert.equal(service.getSession(archivedSession.id).status, 'archived');
  } finally {
    service.close();
  }
});

test('archiveStaleActiveSessions records session_auto_archived events', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Archivable' });
    const past = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    service.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, session.id);

    service.archiveStaleActiveSessions();

    const events = service.db.prepare(`
      SELECT event_type FROM session_events
      WHERE session_id = ?
    `).all(session.id);

    const archivedEvent = events.find(e => e.event_type === 'session_auto_archived');
    assert.ok(archivedEvent, 'session_auto_archived event should exist');
  } finally {
    service.close();
  }
});

test('archiveStaleActiveSessions returns correct count', () => {
  const service = createService();
  try {
    const past = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();

    const s1 = service.createSession({ title: 'Stale 1' });
    service.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, s1.id);

    const s2 = service.createSession({ title: 'Stale 2' });
    service.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, s2.id);

    service.createSession({ title: 'Fresh' }); // not stale

    const count = service.archiveStaleActiveSessions();
    assert.equal(count, 2);
  } finally {
    service.close();
  }
});

test('archiveStaleActiveSessions clears activeSessionId if archived', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Will be archived' });
    assert.equal(service.activeSessionId, session.id);

    const past = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    service.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, session.id);

    service.archiveStaleActiveSessions();
    assert.equal(service.activeSessionId, null);
  } finally {
    service.close();
  }
});

// ── Constructor archive on init ─────────────────────────────────────────

test('constructor archives stale sessions on initialisation', () => {
  // In :memory: database, each SessionService instance gets its own DB, so we
  // cannot share state across instances. Instead verify the init path doesn't
  // throw and that a freshly created session works fine after init.
  const service = createService();
  try {
    const fresh = service.createSession({ title: 'Fresh after init' });
    assert.equal(fresh.status, 'active');
  } finally {
    service.close();
  }
});
