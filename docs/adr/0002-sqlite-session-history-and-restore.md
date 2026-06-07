# ADR-0002: SQLite Session History and Manual Restore

**Status:** Accepted  
**Date:** 2026-06-07  
**Driver:** Need durable interview history, manual Session recovery, and future retrieval support without slowing down the real-time interview answer flow.

## Context

SolveWatch AI currently has a fast live interview pipeline:

```text
speech → STT → AI Channel → streamed answer → HUD
```

The current memory layer is intentionally lightweight: `InterviewTranscriptBuffer` keeps recent Q&A pairs in memory and injects them into prompts. This helps with short-term continuity during a live interview, but it is not durable. If Node.js restarts or the app is closed, the history is lost.

The product direction is expanding from a live HUD into an AI interview operating system with Session history, RAG, resume analysis, and mock interviews. Before those higher-level workflows can exist, the system needs a durable and searchable record of interview Sessions.

We considered borrowing ideas from Codex-style desktop agents, Claude Code session history, and NousResearch Hermes Agent. Those systems preserve conversation trajectories and allow cross-session recall. However, SolveWatch AI has a stricter real-time constraint: live answers must remain fast and stable during an interview.

Therefore, the goal is not to adopt a full general-purpose agent framework. The goal is to add a small local Session history layer that preserves traceability and enables manual restore while keeping the live path simple.

## Decision

### 1. Use SQLite as the local Session store

Session history will be stored in a local SQLite database:

```text
data/solvewatch.db
```

The database file will be ignored by git.

SQLite is chosen because SolveWatch AI is currently a local, single-user desktop app. It avoids running a separate database server and is simple to back up, inspect, and migrate later.

### 2. Use `better-sqlite3` in Node.js

The first implementation will use `better-sqlite3`.

This is acceptable because the first version has light database operations:

- one Conversation Turn write per answered question
- one recent-turn query during manual restore
- history search through REST APIs, not during token streaming

The live answer path must not write or query SQLite on every streamed token.

### 3. Store history as three layers

The Session system has three layers:

```text
session_events          → key lifecycle and processing-stage timeline
conversation_turns      → structured Q&A for display, search, RAG, and review
InterviewTranscriptBuffer → in-memory recent context for live prompt injection
```

#### `session_events`

`session_events` records key milestones, not high-frequency streaming details.

Examples:

- `session_started`
- `session_ended`
- `session_restored`
- `session_auto_created`
- `session_auto_archived`
- `listen_started`
- `listen_stopped`
- `stt_final_received`
- `ai_answer_started`
- `ai_answer_completed`
- `ai_answer_failed`
- `conversation_turn_created`

It will not record:

- every `stt_partial`
- every streamed AI token
- HUD render events
- socket heartbeats

The purpose of this table is traceability: understanding what happened and when.

#### `conversation_turns`

`conversation_turns` stores one meaningful question-answer exchange.

Each turn stores both:

- `raw_transcript` — the original final STT text
- `cleaned_question` — the AI-cleaned question text

If cleaned question extraction fails, `cleaned_question` falls back to `raw_transcript`.

The `answer` field stores only the final answer body, not the `Q:`/`A:` prefix. The question is already stored separately.

Each turn also stores metadata such as provider, model, token counts, cost, latency, and `turn_index`.

`turn_index` is computed from the database:

```text
MAX(turn_index) + 1 per Session
```

The database is the source of truth for ordering.

#### `InterviewTranscriptBuffer`

`InterviewTranscriptBuffer` remains a short-term in-memory context cache. It is not the durable source of truth.

It is used only to keep recent Conversation Turns ready for prompt injection during live answering.

### 4. Manual Session restore loads a fixed recent context window

The first version supports manual restore of a selected Session.

Manual restore will:

1. reactivate the selected Session if it is ended
2. load the most recent 8 Conversation Turns from SQLite
3. clear and hydrate `InterviewTranscriptBuffer` with those turns
4. continue writing future Conversation Turns into the restored Session
5. notify the HUD that restore succeeded

The recent context window is fixed at 8 turns. It is not user-configurable in the first version.

Rationale:

- enough context for continuity
- avoids replaying an entire long interview into the prompt
- keeps live answers fast and predictable
- avoids unnecessary settings complexity

The first version does not implement automatic restore or automatic historical context injection.

### 5. Session lifecycle rules

#### Creation

A Session can be created manually.

If the user does not manually start a Session but a real Q&A is produced, the backend automatically creates a default live Session after the first effective Q&A completes.

Default title format:

```text
Live Interview - YYYY-MM-DD HH:mm
```

Users can rename the Session later in the future Console.

#### Ending

A Session can be ended manually.

Additionally, an active Session with no new Conversation Turn for more than 12 hours will be automatically archived as ended on next startup or before creating a new Session.

#### Restoring

Manual restore of an ended Session reactivates it.

Future Conversation Turns are appended to that same Session.

A separate future action may be introduced for “Use Session as Context” if the user wants to borrow history without writing into the old Session.

### 6. Add FTS5 search in the first version

The first version will create an FTS5 table for searching:

- `cleaned_question`
- `answer`
- `raw_transcript`

This provides a simple local search foundation for history review and later RAG.

FTS synchronization will be manual in the first version:

```text
appendTurn()
  → insert conversation_turns
  → insert conversation_turns_fts
```

All Conversation Turn writes must go through the Session service.

### 7. Session service owns persistence

A new Session service will be the only module that writes Session data.

First-version public interface:

- `createSession(input)`
- `ensureActiveSession()`
- `endSession(sessionId)`
- `restoreSession(sessionId)`
- `appendEvent(sessionId, eventType, payload)`
- `appendTurn(sessionId, turnInput)`
- `getRecentTurns(sessionId, limit = 8)`
- `listSessions()`
- `getSession(sessionId)`
- `getTurns(sessionId)`
- `searchTurns(query)`
- `archiveStaleActiveSessions()`

The first version keeps `activeSessionId` inside the Session service because SolveWatch AI currently has a single active interview flow and the priority is shipping a simple working system.

### 8. `dataHandler.js` hydrates live memory

The Session service returns durable data. It does not manipulate `InterviewTranscriptBuffer` directly.

On restore, `dataHandler.js` will:

1. call `sessionService.restoreSession(sessionId)`
2. receive recent turns
3. clear `InterviewTranscriptBuffer`
4. load recent turns into the buffer
5. emit `session_restored`

This keeps persistence separate from live Socket.IO memory management.

### 9. Split REST and Socket.IO responsibilities

REST APIs are used for history and queries:

- `POST /api/sessions`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/turns`
- `POST /api/sessions/:id/end`
- `GET /api/sessions/search?q=...`

Socket.IO events are used for current live Session state:

- `start_session`
- `end_session`
- `restore_session`
- `session_started`
- `session_ended`
- `session_restored`

Rule of thumb:

```text
Viewing history uses REST.
Changing the current live interview state uses Socket.IO.
```

### 10. Do not build Console UI in the first backend phase

The backend Session core will be implemented first.

The Console frontend stack is not finalized, so the first phase will not add Session UI to the current large settings HTML page.

After the backend contracts are implemented, frontend development documentation should be generated from the actual REST and Socket.IO contracts.

## Consequences

### Positive

- Interview history becomes durable and searchable.
- Manual Session recovery becomes possible without automatic guessing.
- The live answer path remains fast and simple.
- The system gains a clean foundation for future Console, RAG, resume analysis, and mock interview workflows.
- SQLite keeps local development and debugging simple.
- FTS5 gives useful search without introducing a vector database or external service.
- The Session service provides a clear persistence boundary.

### Negative

- First version is local-only and single-user.
- First version does not provide semantic vector retrieval.
- First version does not provide automatic restore or automatic cross-session context injection.
- `better-sqlite3` is synchronous, so heavy queries must stay out of the live token streaming path.
- Manual FTS synchronization requires all writes to go through the Session service.
- Database path may need to change when the app is packaged as a production desktop app.

## Alternatives Considered

### Copy Hermes Agent session/memory code

Rejected.

Hermes Agent contains useful ideas, especially SQLite-backed sessions and FTS-based recall, but its full agent runtime solves a broader problem: tool use, gateways, autonomous skills, cross-platform continuity, and training trajectories. SolveWatch AI needs a smaller real-time interview-specific system.

### Use LangChain memory

Rejected for the first version.

LangChain memory abstractions are unnecessary for a fixed recent-turn prompt context. They would add dependencies and make debugging harder in a latency-sensitive live interview flow.

### Use a vector database immediately

Rejected for the first version.

The first useful retrieval layer can be built with SQLite FTS5 over historical questions and answers. Vector or hybrid retrieval can be added later if FTS5 is insufficient.

### Store only `sessions` and `conversation_turns`

Rejected.

That would be simpler but would lose timeline traceability. `session_events` gives a lightweight audit trail for key lifecycle and processing-stage events.

### Store every streamed token and `stt_partial`

Rejected.

This would bloat SQLite and is not necessary for first-version traceability. Final transcripts, final answers, latency, model, and key events are enough.

### Keep all history only in memory

Rejected.

In-memory context is fast but disappears on restart. It cannot support durable history, search, review, or recovery.

## Follow-ups

- Implement the SQLite Session backend.
- Add tests around Session service behavior.
- Generate frontend API documentation after backend contracts are stable.
- Later decide Console frontend stack.
- Later add Knowledge Base and RAG on top of Session history.
- Later consider session summaries, vector search, and GitNexus-like graph retrieval if needed.
