/**
 * Issue #6 — Restore Sessions into Interview memory.
 *
 * TDD tests for:
 * 1. InterviewTranscriptBuffer — clear() and hydrateFromTurns()
 * 2. SessionService — reactivateSession()
 * 3. DataHandler — restore_session / session_restored flow
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import InterviewTranscriptBuffer from '../src/sockets/InterviewTranscriptBuffer.js';

// ── InterviewTranscriptBuffer ──────────────────────────────────────────

test('InterviewTranscriptBuffer clear() resets entries and utterances', () => {
  const buf = new InterviewTranscriptBuffer();
  buf.addQAPair('Q1', 'A1');
  buf.addQAPair('Q2', 'A2');
  buf.addUtterance('raw transcript');
  assert.equal(buf._entries.length, 2);
  assert.equal(buf._utterances.length, 1);

  buf.clear();
  assert.equal(buf._entries.length, 0);
  assert.equal(buf._utterances.length, 0);
  assert.equal(buf.getMemoryContext(), '');
  assert.equal(buf.getTranscriptContext(), '');
});

test('InterviewTranscriptBuffer hydrateFromTurns() loads Q&A pairs', () => {
  const buf = new InterviewTranscriptBuffer();
  const turns = [
    { cleaned_question: 'What is Redis?', answer: 'A cache.' },
    { cleaned_question: 'What is Node?', answer: 'A runtime.' },
  ];
  buf.hydrateFromTurns(turns);
  assert.equal(buf._entries.length, 2);
  assert.equal(buf._entries[0].q, 'What is Redis?');
  assert.equal(buf._entries[0].a, 'A cache.');
  assert.equal(buf._entries[1].q, 'What is Node?');
  assert.equal(buf._entries[1].a, 'A runtime.');
});

test('InterviewTranscriptBuffer hydrateFromTurns() caps at maxEntries', () => {
  const buf = new InterviewTranscriptBuffer({ maxEntries: 3 });
  const turns = Array.from({ length: 10 }, (_, i) => ({
    cleaned_question: `Q${i}`,
    answer: `A${i}`,
  }));
  buf.hydrateFromTurns(turns);
  assert.equal(buf._entries.length, 3);
  assert.equal(buf._entries[0].q, 'Q7');
  assert.equal(buf._entries[2].q, 'Q9');
});

test('InterviewTranscriptBuffer hydrateFromTurns() clears existing entries first', () => {
  const buf = new InterviewTranscriptBuffer();
  buf.addQAPair('Old Q', 'Old A');
  assert.equal(buf._entries.length, 1);

  buf.hydrateFromTurns([{ cleaned_question: 'New Q', answer: 'New A' }]);
  assert.equal(buf._entries.length, 1);
  assert.equal(buf._entries[0].q, 'New Q');
});

test('InterviewTranscriptBuffer hydrateFromTurns() with empty array clears entries', () => {
  const buf = new InterviewTranscriptBuffer();
  buf.addQAPair('Q', 'A');
  buf.hydrateFromTurns([]);
  assert.equal(buf._entries.length, 0);
});

test('InterviewTranscriptBuffer hydrateFromTurns() with null/undefined is safe', () => {
  const buf = new InterviewTranscriptBuffer();
  buf.hydrateFromTurns(null);
  assert.equal(buf._entries.length, 0);
  buf.hydrateFromTurns(undefined);
  assert.equal(buf._entries.length, 0);
});

test('InterviewTranscriptBuffer getMemoryContext() includes hydrated turns', () => {
  const buf = new InterviewTranscriptBuffer();
  buf.hydrateFromTurns([
    { cleaned_question: 'Q1', answer: 'A1' },
    { cleaned_question: 'Q2', answer: 'A2' },
  ]);
  const ctx = buf.getMemoryContext();
  assert.ok(ctx.includes('Q1'));
  assert.ok(ctx.includes('Q2'));
  assert.ok(ctx.includes('A1'));
  assert.ok(ctx.includes('A2'));
});

test('hydrateFromTurns uses cleaned_question fallback to raw_transcript', () => {
  const buf = new InterviewTranscriptBuffer();
  buf.hydrateFromTurns([
    { raw_transcript: 'raw text', cleaned_question: '', answer: 'answer text' },
  ]);
  assert.equal(buf._entries[0].q, 'raw text');
});

// ── SessionService — reactivateSession ─────────────────────────────────

import { SessionService } from '../src/services/session.service.js';

function createService() {
  return new SessionService({ dbPath: ':memory:' });
}

test('reactivateSession restores ended session to active', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'End me' });
    service.endSession(session.id);
    assert.equal(service.getSession(session.id).status, 'ended');

    const restored = service.reactivateSession(session.id);
    assert.ok(restored);
    assert.equal(restored.status, 'active');
    assert.equal(restored.ended_at, null);
    assert.equal(service.activeSessionId, session.id);
  } finally {
    service.close();
  }
});

test('reactivateSession returns null for non-existent session', () => {
  const service = createService();
  try {
    const result = service.reactivateSession('nonexistent-id');
    assert.equal(result, null);
  } finally {
    service.close();
  }
});

test('reactivateSession rejects active session (not ended)', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Active' });
    assert.throws(
      () => service.reactivateSession(session.id),
      /already active/,
    );
  } finally {
    service.close();
  }
});

test('reactivateSession rejects archived session', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Archived' });
    // Manually set to archived
    service.db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(session.id);
    assert.throws(
      () => service.reactivateSession(session.id),
      /archived/,
    );
  } finally {
    service.close();
  }
});

test('reactivateSession sets activeSessionId even if another session was active', () => {
  const service = createService();
  try {
    const s1 = service.createSession({ title: 'S1' }); // becomes active
    assert.equal(service.activeSessionId, s1.id);
    service.endSession(s1.id); // end s1

    const s2 = service.createSession({ title: 'S2' }); // becomes active
    assert.equal(service.activeSessionId, s2.id);
    service.endSession(s2.id); // end s2, activeSessionId becomes null

    const restored = service.reactivateSession(s1.id);
    assert.equal(restored.id, s1.id);
    assert.equal(service.activeSessionId, s1.id);
  } finally {
    service.close();
  }
});

test('reactivateSession records a session_restored event', () => {
  const service = createService();
  try {
    const session = service.createSession({ title: 'Restore me' });
    service.endSession(session.id);

    service.reactivateSession(session.id);

    const events = service.db.prepare(
      "SELECT event_type, payload_json FROM session_events WHERE session_id = ? ORDER BY event_time ASC"
    ).all(session.id);
    const restoredEvent = events.find(e => e.event_type === 'session_restored');
    assert.ok(restoredEvent, 'session_restored event must exist');
    const payload = JSON.parse(restoredEvent.payload_json);
    assert.equal(payload.title, 'Restore me');
  } finally {
    service.close();
  }
});

// ── getTurns with limit ────────────────────────────────────────────────

test('getTurns accepts limit option and returns N most recent turns', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    for (let i = 0; i < 10; i++) {
      service.appendTurn(session.id, { raw_transcript: `Q${i}`, answer: `A${i}` });
    }

    const all = service.getTurns(session.id);
    assert.equal(all.length, 10);

    const limited = service.getTurns(session.id, { limit: 3 });
    assert.equal(limited.length, 3);
    // Most recent 3 by turn_index (desc): Q7/8/9 → asc: Q7, Q8, Q9
    assert.equal(limited[0].raw_transcript, 'Q7');
    assert.equal(limited[2].raw_transcript, 'Q9');
  } finally {
    service.close();
  }
});

test('getTurns with limit higher than available returns all turns', () => {
  const service = createService();
  try {
    const session = service.ensureActiveSession();
    service.appendTurn(session.id, { raw_transcript: 'Q0', answer: 'A0' });
    service.appendTurn(session.id, { raw_transcript: 'Q1', answer: 'A1' });

    const limited = service.getTurns(session.id, { limit: 10 });
    assert.equal(limited.length, 2);
  } finally {
    service.close();
  }
});
