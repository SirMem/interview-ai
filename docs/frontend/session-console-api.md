# Session Console API

> Frontend-facing contract for the SQLite Session backend.
> Framework-agnostic — any Console implementation (Vue, React, Svelte, plain HTML) can consume these endpoints and events.

---

## Table of Contents

- [Session Lifecycle](#session-lifecycle)
- [REST Endpoints](#rest-endpoints)
- [Socket.IO Events](#socketio-events)
- [REST vs Socket.IO Responsibility Split](#rest-vs-socketio-responsibility-split)
- [Error Handling](#error-handling)
- [FAQ](#faq)

---

## Session Lifecycle

```
created (active) ──→ ended ──→ restored (active again)
     │                             │
     └── auto-archived (12h)       └── auto-archived (12h)
```

| State | Meaning |
|-------|---------|
| `active` | Session is receiving new conversation turns. Only one session is active at a time. |
| `ended` | Session was manually ended. No new turns allowed until restored. |
| `archived` | Session was inactive for ≥12 hours and auto-archived. Archived sessions cannot be restored. |

**Key rules:**
- The backend auto-creates an active session on first use (`ensureActiveSession()`).
- Only one session is active at any time (`sessionService.activeSessionId`).
- An ended session can be restored (changed back to active) via `restore_session`.
- An archived session (stale for ≥12h) is read-only — cannot be restored.
- Ending a session clears `activeSessionId`. Restoring sets it.

---

## REST Endpoints

Base URL: `http://localhost:4000/api`

### `POST /api/sessions`

Create a new manual session.

**Request body** (all optional):

```json
{
  "title": "Backend Mock Interview",
  "type": "mock",
  "company": "ExampleCorp",
  "role": "Backend Engineer",
  "metadata": { "source": "manual" }
}
```

| Field | Type | Default | Max |
|-------|------|---------|-----|
| `title` | string | `"Live Interview - YYYY-MM-DD HH:mm"` | 200 |
| `type` | enum: `live`, `mock`, `resume_review`, `practice` | `live` | — |
| `company` | string | `""` | 200 |
| `role` | string | `""` | 200 |
| `metadata` | object | `{}` | — |

**Response** `201`:

```json
{
  "success": true,
  "session": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "mock",
    "title": "Backend Mock Interview",
    "company": "ExampleCorp",
    "role": "Backend Engineer",
    "status": "active",
    "started_at": "2026-06-08T12:00:00.000Z",
    "ended_at": null,
    "created_at": "2026-06-08T12:00:00.000Z",
    "updated_at": "2026-06-08T12:00:00.000Z",
    "metadata": { "source": "manual" }
  }
}
```

**Error** `400`:

```json
{
  "success": false,
  "error": "metadata must be an object"
}
```

---

### `GET /api/sessions`

List sessions, newest first.

**Query parameters:**

| Param | Type | Default | Max |
|-------|------|---------|-----|
| `limit` | integer | 20 | 100 |
| `offset` | integer | 0 | — |

**Response** `200`:

```json
{
  "success": true,
  "sessions": [
    { "id": "...", "type": "live", "title": "Live Interview - 2026-06-08 15:42", "status": "active", ... }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 1 }
}
```

**Error** `400` (invalid `limit`):

```json
{
  "success": false,
  "error": "limit must be an integer between 1 and 100"
}
```

---

### `GET /api/sessions/:id`

Get a single session by UUID.

**Response** `200`:

```json
{
  "success": true,
  "session": { "id": "...", "title": "...", ... }
}
```

**Error** `404`:

```json
{
  "success": false,
  "error": "Session '<id>' not found"
}
```

---

### `GET /api/sessions/:id/turns`

Get all conversation turns for a session, ordered by `turn_index` ascending.

**Response** `200`:

```json
{
  "success": true,
  "session_id": "550e8400-...",
  "turns": [
    {
      "id": "turn-uuid-1",
      "session_id": "550e8400-...",
      "turn_index": 0,
      "raw_transcript": "What is Redis?",
      "cleaned_question": "Explain Redis caching",
      "answer": "Redis is an in-memory data store.",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "input_tokens": 100,
      "output_tokens": 50,
      "cost_usd": 0.002,
      "latency_ms": 1200,
      "created_at": "2026-06-08T12:00:05.000Z",
      "metadata": {}
    }
  ]
}
```

**Error** `404`:

```json
{
  "success": false,
  "error": "Session '<id>' not found"
}
```

---

### `POST /api/sessions/:id/end`

End an active session manually.

**Response** `200`:

```json
{
  "success": true,
  "session": {
    "id": "...",
    "status": "ended",
    "ended_at": "2026-06-08T12:30:00.000Z",
    ...
  }
}
```

**Error** `404`:

```json
{
  "success": false,
  "error": "Session '<id>' not found"
}
```

---

### `GET /api/sessions/search?q=...`

Full-text search across all conversation turns (cleaned_question, answer, raw_transcript).

**Query parameters:**

| Param | Type | Default | Max |
|-------|------|---------|-----|
| `q` | string | **required** | — |
| `limit` | integer | 20 | 100 |
| `offset` | integer | 0 | — |

Results are ranked by FTS5 relevance (via `rowid` order).

**Response** `200`:

```json
{
  "success": true,
  "turns": [
    {
      "turn_id": "turn-uuid-1",
      "session_id": "session-uuid",
      "turn_index": 0,
      "cleaned_question": "Explain Redis caching",
      "answer": "Redis is an in-memory data store.",
      "raw_transcript": "What is Redis?",
      "snippet": "Explain <b>Redis</b> caching"
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 1 }
}
```

**Error** `400`:

```json
{
  "success": false,
  "error": "query is required for search"
}
```

**Search notes:**
- Search is case-insensitive for ASCII and handles CJK (Chinese/Japanese/Korean) text.
- Special characters (`-`, `"`, `(`, `)`) are stripped before querying FTS5.
- Multiple words are AND-joined — all terms must match.
- The `snippet` field contains an HTML excerpt with `<b>` highlights.

---

## Socket.IO Events

Namespace: `/data-updates`
Transport: WebSocket only (configured in `server.js`).

### Client → Server

#### `end_session`

End the active session.

```javascript
socket.emit('end_session');
```

No payload required. The server looks up `sessionService.activeSessionId` automatically.

**Response:** `session_ended` (broadcast to namespace) or `end_session_error` (to socket).

#### `restore_session`

Restore an ended session by ID.

```javascript
socket.emit('restore_session', { sessionId: '550e8400-...' });
```

**Validation:**
- `sessionId` is required — missing value returns `restore_session_error`.
- Session must exist — non-existent ID returns `restore_session_error`.
- Session must be ended — active or archived sessions return `restore_session_error`.

**On success**, the server:
1. Reactivates the session (status → `active`, `ended_at` → `null`, sets `activeSessionId`).
2. Loads the 8 most recent conversation turns into `InterviewTranscriptBuffer`.
3. Clears any existing in-memory state before hydration.

---

### Server → Client

#### `session_ended`

Broadcast when the active session is ended.

```javascript
{
  "sessionId": "550e8400-...",
  "status": "ended",
  "ended_at": "2026-06-08T12:30:00.000Z"
}
```

#### `end_session_error`

Sent to the requesting socket when end fails.

```javascript
{
  "error": "No active session to end"
  // or "Active session not found"
}
```

#### `session_restored`

Broadcast when a session is successfully restored.

```javascript
{
  "sessionId": "550e8400-...",
  "title": "Backend Mock Interview",
  "restoredTurnCount": 8
}
```

- `restoredTurnCount` indicates how many conversation turns were loaded into memory (max 8, can be fewer if the session has fewer turns).
- The HUD should show only a **restore status** (e.g., "Session restored — 8 turns loaded"). It must NOT render historical Q&A.

#### `restore_session_error`

Sent to the requesting socket when restore fails.

```javascript
// Session not found:
{ "error": "Session '550e8400-...' not found" }

// Session is still active:
{ "error": "Session '550e8400-...' is not ended (status: active)" }

// Missing sessionId:
{ "error": "sessionId is required" }

// Archived session:
{ "error": "Session '550e8400-...' is archived and cannot be reactivated" }
```

---

## REST vs Socket.IO Responsibility Split

| Concern | REST | Socket.IO |
|---------|------|-----------|
| Session history browsing | ✅ List, detail, turns | ❌ |
| Full-text search | ✅ `GET /search?q=...` | ❌ |
| Creating a session | ✅ `POST /api/sessions` | ❌ (auto-created on first use) |
| Ending a session | ✅ `POST /:id/end` | ✅ `end_session` |
| Restoring a session | ❌ | ✅ `restore_session` |
| Live answer events | ❌ | ✅ `interviewer_question`, `question_answer_token`, `question_answer_complete` |
| Session lifecycle events | ❌ | ✅ `session_ended`, `session_restored` |

**Why not put everything in REST?**
Live events (answer tokens, status changes) need real-time push. REST is poll-based. Socket.IO handles both push (server→client) and commands (client→server), but REST is simpler for CRUD operations that don't need real-time updates.

**Why not put everything in Socket.IO?**
REST is easier to test (`curl`), cache, and document. Paginated list responses and search results are natural REST patterns.

---

## Error Handling

All REST errors follow the same shape:

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

HTTP status codes:
| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Validation error (bad input) |
| 404 | Resource not found |
| 500 | Internal server error (unexpected) |

All Socket.IO errors are emitted as individual events (`end_session_error`, `restore_session_error`) with an `error` string field. They do not throw — the server always catches and responds gracefully.

---

## FAQ

**Q: Why can't the frontend read SQLite directly?**
A: SQLite is an embedded database with single-writer semantics. Direct file access from a browser process would require Node.js `better-sqlite3` bindings, duplicate connection management, and risk file corruption if two processes write simultaneously. Always go through the REST API.

**Q: Why does the HUD only show restore status and not historical Q&A?**
A: The HUD is a real-time overlay designed for minimal cognitive load during an interview. Showing historical Q&A would distract from the live question and answer. The Console (future) is the place for browsing past sessions.

**Q: Can I create a session via REST and then use Socket.IO for live events?**
A: Yes. Session creation sets `activeSessionId`, and all subsequent Socket.IO events (`stt_final`, `end_session`, etc.) use that active session. REST and Socket.IO share the same `SessionService` singleton.

**Q: What happens if I end a session while the AI is still answering?**
A: The AI answer completes and emits `question_answer_complete`. The turn is appended via `setTimeout(0).unref()` — it writes asynchronously and does not block the event loop. The write may complete after the session is already ended.

**Q: How many sessions can I have?**
A: Unlimited. SQLite has no hard limit. Pagination (`limit`/`offset`) is built into the list endpoint. Sessions older than 12 hours of inactivity are auto-archived on service startup.
