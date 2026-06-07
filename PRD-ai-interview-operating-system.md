# PRD Draft: SolveWatch AI — AI Interview Operating System

**Status:** Draft  
**Date:** 2026-06-07  
**Scope:** Product and architecture planning for evolving SolveWatch AI from a real-time interview answer HUD into a full AI interview preparation, assistance, and review platform.

---

## Problem Statement

SolveWatch AI currently works well as a real-time interview assistant: it captures microphone or system audio, transcribes speech, sends interview questions to a configured AI Channel, and streams answers into a lightweight HUD.

However, the current product is still centered around a single live pipeline:

```text
speech → STT → one AI call → one streamed answer → HUD
```

This creates several limitations:

1. **No durable interview history** — previous interview questions, answers, transcripts, latency, model usage, and outcomes are not persistently available as first-class product data.
2. **No reliable session recovery** — if the app restarts or the HUD reconnects, the current interview context is not restored from durable storage.
3. **Limited cross-interview learning** — the system cannot search prior interviews to reuse answers, discover repeated question patterns, or build a review loop.
4. **Settings page is becoming too large** — the current single HTML settings page is already carrying provider management, audio settings, prompt controls, and other operational UI. Adding session history, knowledge base management, resume analysis, and mock interviews into the same file would make the frontend hard to maintain.
5. **No interview preparation workflow** — users cannot upload resumes, analyze project experience, generate targeted questions, simulate interviewers, or review performance after practice.
6. **No structured knowledge base** — there is no unified store for resumes, job descriptions, interview history, technical notes, question banks, or retrieval-augmented context.

The core product challenge is therefore not merely adding an “agent framework.” The first-principles goal is to create a durable, searchable, modular interview operating system while preserving the current real-time pipeline’s speed and reliability.

---

## Solution

Transform SolveWatch AI into an **AI Interview Operating System** with two clearly separated frontend surfaces and a durable backend knowledge layer.

### Product Split

#### 1. HUD Overlay

The HUD remains a lightweight, low-latency interview-time surface.

It should only handle:

- Listening state
- Live transcription display
- Current question display
- Streaming AI answer display
- Minimal session status
- Minimal error/status indicators

It should not handle:

- SQLite access
- Full session browsing
- Resume upload and analysis
- Knowledge base management
- Mock interview orchestration
- Heavy settings workflows
- Long-form reports

#### 2. Control Console / Studio

Introduce a full web console for all complex workflows.

The Console should handle:

- Channel configuration
- Audio and STT settings
- Session history
- Session replay and continuation
- Search across previous interviews
- Resume analysis
- Job description alignment
- Knowledge base management
- Mock interview setup and execution
- Interview reports and review workflows

### Backend Direction

The backend becomes the durable orchestration layer:

```text
HUD / Console
    ↓ REST + Socket.IO
Node.js Backend
    ↓
SQLite Session Store + Knowledge Store
    ↓
AI Channels + STT + RAG Context Builder
```

Key backend capabilities:

1. **SQLite-backed Session History**
   - Store every interview session.
   - Store raw transcripts, cleaned questions, answers, model metadata, token usage, cost, and latency.
   - Provide session list, session detail, search, and resume APIs.

2. **Session Recovery**
   - On reconnect or explicit resume, load the session’s recent turns into Interview memory.
   - Allow the live assistant to continue from prior context without requiring the frontend to manage persistence.

3. **Search / RAG Layer**
   - Start with SQLite FTS5 for durable full-text search over interview history.
   - Later extend to document chunks, resume content, job descriptions, and technical notes.
   - Keep retrieval fast and local before considering heavier vector or graph systems.

4. **Resume and Job Context Layer**
   - Store resume versions.
   - Extract projects, skills, claims, risk points, and likely interviewer questions.
   - Connect resume data to mock interview and live answer context.

5. **Mock Interview Engine**
   - Support virtual AI interviewers.
   - Generate question plans from resume, job role, job description, and target interview type.
   - Capture user answers through STT.
   - Generate follow-up questions, scoring, and post-interview reports.

### Strategic Principle

Do not replace the real-time AI pipeline with a general-purpose agent loop yet.

The immediate production-grade path is:

```text
fast real-time answer pipeline
+ durable sessions
+ searchable history
+ knowledge retrieval
+ modular Console
```

Tool calling and full autonomous agent behavior are intentionally deferred until the session, retrieval, and product surfaces are stable.

---

## User Stories

### Live Interview Assistance

1. As a candidate, I want the HUD to stay lightweight and responsive during a live interview, so that it does not distract me or fail under pressure.
2. As a candidate, I want the HUD to show the current listening state, so that I know whether the system is actively capturing audio.
3. As a candidate, I want the HUD to show live transcription, so that I can verify whether the system heard the interviewer correctly.
4. As a candidate, I want the HUD to show the cleaned interview question, so that I can quickly understand what the AI is answering.
5. As a candidate, I want the HUD to stream the answer token by token, so that I receive help as quickly as possible.
6. As a candidate, I want the live answer flow to remain fast even when history persistence fails, so that the interview experience is not blocked by storage issues.
7. As a candidate, I want the system to record each question and answer in the background, so that I can review the interview later.
8. As a candidate, I want the system to preserve raw transcript and cleaned question separately, so that I can audit transcription or question extraction mistakes.
9. As a candidate, I want the system to remember recent turns in the current interview, so that answers can account for previous questions.
10. As a candidate, I want the system to recover recent context after reconnecting, so that a HUD refresh or restart does not lose the interview flow.

### Session History

11. As a candidate, I want each interview to become a durable Session, so that I can revisit it later.
12. As a candidate, I want Sessions to have titles, timestamps, roles, and optional company names, so that I can find the right interview quickly.
13. As a candidate, I want to see all questions and answers from a Session, so that I can review what happened.
14. As a candidate, I want to search across all historical questions, so that I can find repeated patterns.
15. As a candidate, I want to search across answer text, so that I can reuse previous strong answers.
16. As a candidate, I want to filter Sessions by date, role, company, or interview type, so that I can review targeted history.
17. As a candidate, I want to mark questions as important, weak, or needs-review, so that I can build a focused review list.
18. As a candidate, I want to copy any previous answer, so that I can reuse it in notes or practice.
19. As a candidate, I want to see which AI Channel and model answered each question, so that I can understand answer quality and cost.
20. As a candidate, I want to see latency and token/cost metadata, so that I can optimize the system for interview-time performance.
21. As a candidate, I want to resume a prior Session manually, so that I can continue a long-running or interrupted interview.
22. As a candidate, I want the backend to restore Session context without requiring the frontend to read SQLite, so that frontend complexity stays low.

### Control Console

23. As a candidate, I want a full Console separate from the HUD, so that complex workflows do not bloat the interview overlay.
24. As a candidate, I want the Console to manage Channels, so that provider configuration remains easy to edit.
25. As a candidate, I want the Console to manage audio source mode, so that I can choose microphone or system audio capture.
26. As a candidate, I want the Console to show Session history, so that I can review interviews outside the HUD.
27. As a candidate, I want the Console to show Knowledge Base documents, so that I can manage what the AI can retrieve.
28. As a candidate, I want the Console to show resumes and resume versions, so that I can compare preparation material over time.
29. As a candidate, I want the Console to run mock interviews, so that I can practice before real interviews.
30. As a candidate, I want the Console to produce reports, so that I can understand strengths, weaknesses, and next actions.

### RAG / Knowledge Base

31. As a candidate, I want previous interview Q&A to be searchable, so that the system can recall similar past questions.
32. As a candidate, I want resume content to be available as context, so that answers align with my actual experience.
33. As a candidate, I want job descriptions to be stored and searchable, so that preparation can target a specific role.
34. As a candidate, I want technical notes or question banks to be imported, so that the AI can draw from my own learning material.
35. As a candidate, I want retrieval to prefer local, fast sources first, so that live answers remain responsive.
36. As a candidate, I want retrieved context to be visible in review mode, so that I can audit why the AI answered a certain way.
37. As a candidate, I want the system to distinguish Session history from general knowledge documents, so that retrieval can use the right source for the right task.
38. As a candidate, I want the system to support FTS search before heavier vector search, so that the first version is reliable and simple.
39. As a candidate, I want the system to later support embedding or graph retrieval if needed, so that the knowledge layer can evolve.
40. As a candidate, I want GitNexus-like knowledge graph search to remain a future option, so that codebase or technical knowledge can become richer without blocking the first version.

### Resume Analysis

41. As a candidate, I want to upload or paste my resume, so that the system can analyze my background.
42. As a candidate, I want the system to extract projects, skills, technologies, and claims from my resume, so that interview preparation is grounded in my real profile.
43. As a candidate, I want the system to identify weak or risky resume claims, so that I can prepare better explanations.
44. As a candidate, I want the system to generate likely interview questions from my resume, so that I can practice high-probability topics.
45. As a candidate, I want to compare a resume against a job description, so that I know where my experience matches or misses the role.
46. As a candidate, I want resume analysis to feed mock interviews, so that virtual interviewers can ask realistic questions.
47. As a candidate, I want resume analysis to feed live-answer context, so that suggested answers sound personal and credible.
48. As a candidate, I want multiple resume versions, so that I can track changes across different job targets.

### Mock Interview

49. As a candidate, I want to start a virtual AI interview, so that I can practice without a real interviewer.
50. As a candidate, I want to select an interview type, such as behavioral, coding, system design, resume deep-dive, or project deep-dive, so that the mock interview matches my target.
51. As a candidate, I want to select a role and company context, so that the mock interviewer asks relevant questions.
52. As a candidate, I want the AI interviewer to ask one question at a time, so that the simulation feels realistic.
53. As a candidate, I want to answer mock interview questions by voice, so that practice matches the real interview format.
54. As a candidate, I want the system to transcribe my answers, so that I can review exactly what I said.
55. As a candidate, I want the AI interviewer to ask follow-up questions, so that it can probe weak or vague answers.
56. As a candidate, I want the mock interview to create a normal Session, so that it can be searched and reviewed like real interviews.
57. As a candidate, I want a post-interview report, so that I know what to improve.
58. As a candidate, I want scoring by dimensions such as clarity, correctness, depth, structure, and confidence, so that feedback is actionable.
59. As a candidate, I want suggested improved answers, so that I can practice better versions.
60. As a candidate, I want repeated mock interviews to build a progress history, so that I can see improvement over time.

### Admin / Reliability

61. As a developer, I want persistence failures to be logged but not block live answer streaming, so that reliability is optimized for interview use.
62. As a developer, I want deep modules with narrow interfaces for sessions, retrieval, resumes, and mock interviews, so that each part can be tested independently.
63. As a developer, I want the frontend Console to be modular, so that adding new product areas does not increase a single-file maintenance burden.
64. As a developer, I want APIs to remain stable across frontend rewrites, so that HUD and Console can evolve independently.
65. As a developer, I want the SQLite schema to be simple and append-friendly, so that migrations are low risk.
66. As a developer, I want search to be local-first, so that the app does not depend on external services for historical recall.
67. As a developer, I want Channel scheduling to remain independent of Session storage, so that provider failover and persistence can fail independently.
68. As a developer, I want the product to defer generic tool calling, so that scope stays focused on production-ready interview workflows.

---

## Implementation Decisions

### 1. Separate HUD and Console

Decision: keep the HUD as the real-time interview overlay and introduce a full Console for complex workflows.

Rationale:

- The HUD must remain low-latency and low-risk.
- The current single HTML settings page is already large and will not scale to session history, resume analysis, knowledge management, and mock interviews.
- A full frontend app provides routing, components, state management, and testable UI boundaries.

Recommended Console stack:

- Vite-based frontend app
- TypeScript
- Component-based UI framework
- Router for pages
- Client API layer for backend calls
- Store layer for shared state

Initial Console pages:

- Dashboard
- Settings / Channels
- Sessions
- Session Detail
- Knowledge Base
- Resumes
- Mock Interview
- Reports

### 2. Backend Owns SQLite

Decision: frontend never accesses SQLite directly.

Rationale:

- The existing architecture already centralizes business logic in Node.js.
- SQLite access belongs in backend services.
- HUD and Console should interact only through REST APIs and Socket.IO events.
- This keeps frontend code portable and avoids database coupling.

### 3. Introduce a Session Service

Decision: create a deep backend module responsible for interview Session lifecycle and persistence.

Core responsibilities:

- Create Session
- Resume Session
- End Session
- Append transcript utterance
- Append question-answer turn
- Load recent turns for prompt memory
- List Sessions
- Retrieve Session detail
- Search Session history
- Track usage/cost/latency metadata

External interface should remain simple and stable.

### 4. Replace Ephemeral-Only Interview Memory With Session-Backed Memory

Decision: keep the current rolling Interview memory concept for low-latency prompt injection, but hydrate it from SQLite when a Session starts or resumes.

Rationale:

- The rolling buffer is useful for fast in-memory context during live answering.
- Durable storage should be the source of truth.
- The live answer path should not wait on expensive retrieval unless explicitly enabled.

Expected behavior:

- New Session starts with empty or selected historical context.
- Resumed Session loads recent Q&A turns.
- Each completed answer writes to SQLite asynchronously.
- If persistence fails, live answer still completes.

### 5. Start RAG With SQLite FTS5

Decision: first version of retrieval should use SQLite FTS5 over Session history and knowledge documents.

Rationale:

- Local-first, fast, zero external service.
- Enough for historical interview recall and keyword-based technical notes.
- Avoid premature complexity from embeddings, vector databases, or full knowledge graph infrastructure.

Potential later upgrades:

- Embedding-based semantic retrieval
- Hybrid FTS + vector search
- Graph-style relationships between resume claims, questions, answers, and knowledge documents
- GitNexus-like code knowledge search as an external retrieval provider

### 6. Add a Knowledge Service After Session Storage

Decision: build Knowledge Base after Session history is reliable.

Core responsibilities:

- Store documents
- Chunk documents
- Index chunks for FTS search
- Link source documents to retrieved chunks
- Support document types: resume, job description, technical note, question bank, interview summary

### 7. Resume Analysis Becomes a First-Class Product Area

Decision: model resumes separately from general knowledge documents while allowing resume content to be indexed for retrieval.

Rationale:

- Resumes have versions, projects, skills, claims, and role alignment needs.
- Resume analysis feeds both live answer personalization and mock interview generation.

Core capabilities:

- Upload or paste resume
- Store resume versions
- Extract structured project and skill claims
- Identify likely questions
- Identify risk points and weak claims
- Compare against job descriptions

### 8. Mock Interview Comes After Session + Resume + Knowledge

Decision: defer virtual AI interview until the core data layers exist.

Rationale:

- Mock interview depends on Session persistence, resume context, retrieval, STT, and reporting.
- Building it too early would create duplicated conversation logic.

Mock interviews should reuse the same Session store but use a different Session type.

### 9. Defer Tool Calling and General Agent Loop

Decision: do not add a Hermes-style full agent loop in the first production phase.

Rationale:

- The current live interview path values speed more than autonomous multi-step reasoning.
- Session history, FTS retrieval, and structured knowledge provide immediate value with lower risk.
- Tool calling can be introduced later around specific workflows, such as resume parsing, report generation, or knowledge ingestion.

### 10. Use Hermes Agent as Design Inspiration, Not Code To Copy

Decision: borrow concepts from Hermes Agent, not its implementation wholesale.

Useful concepts:

- SQLite-backed session persistence
- FTS5 search for cross-session recall
- Session lifecycle commands
- Conversation compression or summarization as a later optimization

Not recommended for direct adoption:

- Full general-purpose agent runtime
- Multi-platform gateway abstractions
- Autonomous skill creation
- Heavy tool/plugin ecosystem
- Training trajectory compression

Rationale:

- SolveWatch AI has a real-time audio/HUD constraint that Hermes does not optimize for.
- Copying a large agent framework would add unnecessary complexity and dependencies.

---

## Proposed Data Model

This is a planning-level model, not a final schema.

### InterviewSession

Represents one real or mock interview.

Suggested fields:

- id
- type: live, mock, resume_review, practice
- title
- company
- role
- status: active, ended, archived
- started_at
- ended_at
- source_audio_mode
- active_channel
- metadata

### ConversationTurn

Represents one question-answer pair.

Suggested fields:

- id
- session_id
- turn_index
- raw_transcript
- cleaned_question
- answer
- answer_source: live_assist, mock_interviewer, review_report
- provider
- model
- input_tokens
- output_tokens
- cost_usd
- latency_ms
- created_at
- tags
- review_status

### TranscriptUtterance

Represents raw speech chunks or finalized STT segments.

Suggested fields:

- id
- session_id
- text
- speaker_type: interviewer, candidate, unknown
- is_final
- timestamp
- metadata

### KnowledgeDocument

Represents imported or generated knowledge.

Suggested fields:

- id
- type: resume, job_description, technical_note, question_bank, interview_summary
- title
- source
- content
- created_at
- updated_at
- metadata

### KnowledgeChunk

Represents searchable chunks from documents.

Suggested fields:

- id
- document_id
- chunk_index
- content
- token_count
- metadata

### ResumeVersion

Represents a versioned resume.

Suggested fields:

- id
- title
- raw_content
- parsed_profile
- created_at
- metadata

### MockInterviewPlan

Represents a planned virtual interview.

Suggested fields:

- id
- session_id
- interview_type
- target_role
- difficulty
- question_plan
- evaluation_rubric
- metadata

---

## API Contracts

Planning-level API surface.

### Session APIs

- Create Session
- Resume Session
- End Session
- List Sessions
- Get Session detail
- Get Session turns
- Search Sessions
- Update Session metadata
- Mark turn review status

### Knowledge APIs

- Add document
- List documents
- Get document
- Delete document
- Re-index document
- Search knowledge
- Retrieve context for a query

### Resume APIs

- Add resume version
- List resume versions
- Analyze resume
- Compare resume against job description
- Generate likely interview questions

### Mock Interview APIs

- Create mock interview
- Start mock interview
- Submit candidate answer
- Generate follow-up question
- End mock interview
- Generate report

### Socket.IO Events

Potential Session-related events:

- start_interview_session
- session_started
- resume_interview_session
- session_restored
- end_interview_session
- session_ended
- session_persist_warning

The live STT and answer events should remain optimized for streaming and should not be redesigned unless necessary.

---

## Phased Roadmap

### Phase 1 — Durable Session History

Goal: every real interview becomes traceable.

Deliverables:

- SQLite Session store
- Session service
- Session lifecycle events
- Persist Q&A turns
- Persist transcript utterances where useful
- REST APIs for session list and detail
- Basic recovery of recent Q&A into Interview memory
- Minimal history UI, either temporary or in the new Console shell

Success criteria:

- A completed live interview can be found after app restart.
- Each answered question has raw transcript, cleaned question, answer, provider/model, latency, and cost metadata.
- Resuming a Session restores recent turns into prompt memory.
- Persistence failure does not block live answer streaming.

### Phase 2 — Console Foundation

Goal: stop expanding the single HTML settings page.

Deliverables:

- New Console app shell
- Routing
- API client layer
- Layout/navigation
- Settings/Channels page migrated or mirrored
- Sessions page
- Session detail page
- Legacy settings page kept temporarily for safety

Success criteria:

- New functionality has a modular frontend home.
- Existing Channel management can be used from the Console.
- Session history can be browsed without touching the HUD.

### Phase 3 — Search and Local RAG

Goal: historical interview recall becomes useful.

Deliverables:

- SQLite FTS5 index over questions and answers
- Session search API
- Search UI
- Basic retrieval context builder
- Optional live answer injection from relevant historical Q&A
- Retrieval audit display in Session detail

Success criteria:

- User can search previous interviews by topic.
- Live answer generation can optionally include relevant prior Q&A.
- Retrieval adds value without noticeable live latency degradation.

### Phase 4 — Knowledge Base

Goal: make resumes, job descriptions, notes, and question banks available as searchable context.

Deliverables:

- Knowledge document store
- Document chunking
- FTS indexing
- Knowledge search UI
- Retrieval context builder across Session history and documents
- Document source attribution

Success criteria:

- User can add a document and retrieve relevant chunks.
- Retrieved chunks can be shown in the Console.
- Live and mock workflows can use knowledge context through a backend API.

### Phase 5 — Resume Analysis

Goal: turn resume content into structured interview preparation.

Deliverables:

- Resume version storage
- Resume parsing and analysis
- Project/skill/claim extraction
- Risk point detection
- Likely question generation
- Resume versus job description comparison
- Resume-aware retrieval context

Success criteria:

- User can upload or paste a resume and receive structured interview preparation output.
- Generated questions are grounded in resume content.
- Resume context can inform live or mock interviews.

### Phase 6 — Mock Interview

Goal: support virtual AI interview practice.

Deliverables:

- Mock interview setup flow
- Interviewer persona and rubric selection
- Question plan generation
- Voice-based candidate answers through STT
- Follow-up question generation
- Post-interview report
- Mock interview Sessions stored in the same Session system

Success criteria:

- User can complete a realistic mock interview.
- The mock interview is stored, searchable, and reviewable.
- Reports identify actionable improvement areas.

### Phase 7 — Advanced Retrieval and Agentic Extensions

Goal: add heavier intelligence only after core workflows are stable.

Possible deliverables:

- Hybrid FTS + vector retrieval
- Knowledge graph relationships
- GitNexus-style code knowledge integration
- Tool calling for bounded tasks
- Summarization/compression for long Sessions
- Automated review recommendations

Success criteria:

- Advanced retrieval improves answer quality measurably.
- Tool use is introduced only for specific workflows with clear latency and reliability boundaries.

---

## Testing Decisions

### Testing Philosophy

Tests should focus on external behavior and stable contracts, not implementation details.

Good tests answer questions such as:

- When a Session is created, can it be listed and resumed?
- When a Q&A turn is appended, can it be retrieved in order?
- When the app restarts, does durable history remain available?
- When search is performed, does it return relevant turns?
- When persistence fails, does live answer streaming still complete?
- When a HUD reconnects with a Session ID, does backend context restore correctly?

Avoid tests that assert private helper names, exact SQL strings, or internal state shape unless those are intentional public contracts.

### Modules To Test

Recommended high-priority modules:

1. **Session Service**
   - Create, resume, end Session
   - Append Q&A turn
   - Append utterance
   - Load recent context
   - Search history
   - Handle missing or invalid Session IDs

2. **Retrieval / RAG Service**
   - Index content
   - Search content
   - Rank and limit retrieved context
   - Distinguish source types
   - Handle empty results gracefully

3. **Data Handler Session Integration**
   - Start Session event
   - Resume Session event
   - End Session event
   - Persist completed answer asynchronously
   - Continue streaming when persistence fails

4. **Session REST APIs**
   - List Sessions
   - Get Session detail
   - Get turns
   - Search Sessions
   - Validate input and error responses

5. **Console API Client**
   - Contract tests or integration tests around frontend API calls if the Console becomes substantial.

### Testing Strategy

- Use temporary SQLite databases for tests.
- Keep Session service tests independent from AI provider calls.
- Mock AI streaming only when testing integration behavior around persistence.
- Use deterministic seed data for search tests.
- Test recovery behavior explicitly.
- Add regression tests for persistence failures not blocking live answer flow.

---

## Out of Scope

The following are intentionally out of scope for the first implementation wave:

1. Full Hermes-style autonomous agent runtime.
2. Generic tool calling in live interview answers.
3. Autonomous skill creation.
4. Multi-platform chat gateways.
5. Cloud sync of Sessions.
6. Multi-user authentication.
7. Team collaboration.
8. Fine-tuning or training from trajectories.
9. Heavy knowledge graph infrastructure as a Phase 1 dependency.
10. Replacing the current AI Channel scheduling system.
11. Replacing the current STT pipeline.
12. Moving HUD to a full frontend framework.
13. Making the frontend read SQLite directly.

---

## Further Notes

### Architecture Principle

The system should optimize live interview flow for speed and reliability, while moving all complex preparation and review workflows into a modular Console.

```text
Live path = fast, minimal, failure-tolerant
Console path = rich, modular, reviewable
Backend = durable source of truth
```

### Hermes Agent Inspiration

Hermes Agent is useful as an architectural reference for session persistence and FTS5-based cross-session recall. It should not be copied wholesale because SolveWatch AI has a different product constraint: real-time local audio capture and low-latency HUD streaming.

### GitNexus-Like Knowledge Graph

GitNexus-like graph retrieval is a promising advanced retrieval direction, especially for codebase-specific or technical knowledge. It should be treated as an extension of the Knowledge Base, not as the first storage layer for interview Sessions.

### Frontend Risk

The largest near-term maintainability risk is continuing to grow a single HTML settings page. The Console foundation should be introduced before adding large new product areas.

### Recommended Immediate Next Step

Start with Phase 1 and Phase 2 in parallel planning:

1. Build durable Session storage and APIs.
2. Create the Console shell so future functionality has a modular home.

This creates the foundation for RAG, resume analysis, and mock interviews without destabilizing the current real-time interview assistant.
