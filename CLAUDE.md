# SolveWatch AI — Claude Code Context

## Project Overview
Real-time interview assistant: spoken questions → STT → AI answer → streaming overlay.

**Stack:**
- `src/` — Node.js backend (Express + Socket.IO)
- `transcriber/` — Python STT service (FastAPI + Whisper + VAD)
- `electron/` — Desktop overlay

---

## Active Task: Conversation Memory System

### Problem
Follow-up questions like "what are its features?" break because:
- `InterviewTranscriptBuffer.js` only stores last 15 **raw interviewer utterances**
- AI answers are never stored — so AI has no idea what it just answered about
- Each AI call is effectively stateless

### Agreed Design

**Two-tier memory stored in `InterviewTranscriptBuffer`:**

```
conversationMemory = {
  summaries: [String],   // compressed batches of old Q&A (via local Ollama)
  recentPairs: [         // last 3-5 raw Q&A pairs (always fresh, no wait)
    { q: String, a: String }
  ]
}
```

**Rules:**
- Every AI call injects: `[summaries joined] + [recentPairs]` into the prompt
- After each `question_answer_complete`: write Q&A pair to `recentPairs`
- When `recentPairs.length` hits 5: trigger **async** Ollama summarization → push result to `summaries[]` → remove those 5 from `recentPairs`
- If Ollama is still summarizing when next question arrives: skip summaries, send raw pairs only (non-blocking)

**Token budget:** ~850 tokens max overhead (2-3 summaries × 150 tokens + 3 raw pairs × 400 tokens)

---

## Files to Modify

### 1. `src/sockets/InterviewTranscriptBuffer.js`
- Add `conversationMemory = { summaries: [], recentPairs: [] }`
- Add `addQAPair(question, answer)` — writes to `recentPairs`, triggers batch summarization at 5
- Add `getMemoryContext()` — returns formatted string of summaries + recent pairs
- Add `summarizeBatchAsync()` — calls local Ollama to compress 5 Q&A pairs into ~150-token summary

### 2. `src/services/ai.service.js`
- Add `summarizeBatch(pairs)` method using Ollama (`http://localhost:11434/v1`)
- Inject `memoryContext` into prompts for `classifyAndAnswerInterviewQuestion()` and `answerInterviewQuestion()`

### 3. `src/sockets/dataHandler.js`
- After `question_answer_complete` fires: call `buffer.addQAPair(questionText, fullAnswer)`

### 4. `prompts/interview-answer-prompt.txt` and `prompts/interview-combined-prompt.txt`
- Add memory context section to prompt template:
```
{{#if memory}}
## Conversation History
{{memory}}
{{/if}}
```

---

## Key Existing Code to Understand First

- `InterviewTranscriptBuffer.js` — current session model (utterances buffer, question queue)
- `ai.service.js` — `classifyAndAnswerInterviewQuestion()` and `answerInterviewQuestion()` — where prompts are built
- `dataHandler.js` — `handleInterviewerSpeech()` — the main flow that calls AI and emits answer events
- `prompts/interview-combined-prompt.txt` — current prompt template

---

## Constraints
- Summarization must be **non-blocking** — never delay an AI answer call
- Use existing Ollama integration (already configured in `ai.service.js`)
- Memory is **per-session** only (in-memory, not persisted to disk)
- Keep `recentPairs` capped at 5 before summarization trigger
- Keep `summaries` capped at 3 (drop oldest if exceeded) to bound token cost
