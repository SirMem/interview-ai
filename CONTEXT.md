# SolveWatch AI — Domain Context

## Glossary

### Channel
A named AI provider configuration containing base URL(s), API key(s), service type, model name, and scheduling state. Represented as an entry in `config/channels.json`.

### Channel configuration store
`config/channels.json` — single JSON file replacing the flat `.env` keys for provider settings.

### Channel status
One of `active` (normal), `paused` (circuit-breaker triggered), or `disabled` (manually turned off).

### Priority
An integer per channel. Lower number = higher scheduling priority. Same priority = round-robin.

### Circuit breaker
When a channel fails 3 consecutive times, its status transitions to `paused` automatically.

### Service type
The wire protocol used to talk to the upstream API. Two values:
- `openai-compatible` — uses the `openai` npm SDK (`chat.completions.create`)
- `anthropic` — uses the `@anthropic-ai/sdk` npm SDK (`messages.create`)

### WASAPI loopback
A Windows audio capture method that records speaker output directly. Used as an alternative to microphone input (captures VoIP call audio while wearing headphones). Implemented via `pyaudiowpatch` in `system_audio_capture.py`.

### Audio source mode
`mic` (default microphone) or `system` (WASAPI loopback, captures speaker output).

### HUD Overlay
The lightweight interview-time interface used during a live interview. It should focus on listening state, live transcription, current question, and streaming answers.

### Control Console
The full product workspace used outside the live overlay for setup, review, preparation, Session history, knowledge management, resume analysis, and mock interviews.

### Interview Session
A durable record of one real or mock interview, including its timeline, transcript, question-answer turns, role/company context, and review metadata.

### Active Interview Session
The Interview Session currently receiving new Conversation Turns from the live assistant or mock interview flow.

### Ended Interview Session
An Interview Session that no longer receives new Conversation Turns unless the user explicitly resumes it.

### Conversation Turn
One meaningful question-answer exchange inside an Interview Session. A turn may preserve both the raw transcript and the cleaned question.

### Session Event
A key lifecycle or processing-stage record inside an Interview Session timeline. Session Events are for traceability and should record important milestones rather than high-frequency streaming details.

### Session history
The searchable collection of past Interview Sessions and Conversation Turns used for review, recovery, and retrieval-augmented context.

### Session restore
A manual action that loads a selected Interview Session’s recent Conversation Turns back into Interview memory so the live assistant can continue with that context. First version should restore by explicit Session selection, not by automatic guessing.

### Session reactivation
The result of restoring an Ended Interview Session for continued work: the selected Session becomes active again and receives future Conversation Turns.

### Recent context window
The bounded subset of recent Conversation Turns placed into Interview memory for live prompt context. It exists to keep answers fast and relevant rather than replaying an entire Session.

### Interview memory
A short-term in-memory context cache used only during live answering. It keeps recent Conversation Turns and transcript snippets ready for prompt injection. It is not the durable source of truth; it can be hydrated from Session history during manual Session restore.

### AI pipeline
```
stt_final text → readPromptFromFile('interview-answer')
  → replace {TRANSCRIPT_CONTEXT} and {MEMORY_CONTEXT}
  → add interview_role prefix (if set)
  → callAIWithFallbackStream(messages)
  → channel scheduling → SDK → AI → stream tokens to HUD
```

