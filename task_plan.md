# Task Plan: SolveWatch AI — SQLite Session History & Manual Restore

> 基于 PRD-ai-interview-operating-system.md + ADR-0002 的 9-Issue 分阶段计划。
> 目标是：从实时面试辅助升级为可追溯面试操作系统，第一波集中在 Session 持久化与手动恢复。

## Current Phase
Phase 1 + Phase 2 Complete ✅ — Issue #1 和 Issue #2 均已实现

## 下一步：Issue #3 — Record key Session Events for traceability

Session Events 增加 traceability 记录关键生命周期事件（session_started, ai_answer_completed 等）

## 已完成的工作

### ✓ Issue #1 — SQLite Session Store + REST APIs (已完成)
- `src/services/session.service.js` — SQLite 持久化，建 4 张表（sessions / conversation_turns / session_events / conversation_turns_fts），提供 `createSession/listSessions/getSession`
- `src/controllers/session.controller.js` — 校验 + JSON 响应映射
- `src/routes/session.routes.js` — POST/GET /sessions, GET /sessions/:id
- `test/session.service.test.js` + `test/session.routes.test.js` — 12 tests, all passing
- `data/solvewatch.db` — 自动创建并 gitignored
- `package.json` — 添加 `better-sqlite3`，`node --test` 为测试运行器
- `CHANGELOG.md` — [Unreleased] 条目已添加
- PR #10 merged → main（`76f083e`）

### ✓ Issue #2 — Persist live Q&A as Conversation Turns (已完成)
- `sessionService.ensureActiveSession()` — 若没有 active session，自动创建默认 live Session
- `sessionService.appendTurn(sessionId, turnInput)` — 写入 conversation_turns + conversation_turns_fts
- `sessionService.getTurns(sessionId)` — 返回 ordered turns
- 保存 `raw_transcript` + `cleaned_question` + `answer` + provider/model/tokens/latency
- fallback 规则：cleaned_question 失败时 = raw_transcript
- `turn_index = MAX(turn_index) + 1`
- `GET /api/sessions/:id/turns` — REST endpoint
- 写库通过 `setTimeout(0).unref()` 不阻塞 HUD token streaming
- 测试 27 个（20 service + 7 routes），全部通过
- `dataHandler.js`: `_streamInterviewAnswer()` now returns `cleanedQuestion`; `handleSttFinal()` 尾部 fire-and-forget 持久化

## 当前 Phase — Issue #2: Persist live Q&A as Conversation Turns

### Scope
将实时面试的完整问答（STT final → AI answer）持久化到 Conversation Turns。

### 关键实现点
- `sessionService.ensureActiveSession()` — 若没有 active session，自动创建默认 live Session
- `sessionService.appendTurn(sessionId, turnInput)` — 写入 conversation_turns + conversation_turns_fts
- 保存 `raw_transcript` + `cleaned_question` + `answer`
- fallback 规则：cleaned_question 失败时 = raw_transcript
- `answer` 只存答案正文，不含 Q:/A: 前缀
- `turn_index = MAX(turn_index) + 1`
- `GET /api/sessions/:id/turns`
- 写库不能阻塞 HUD token streaming

### 被阻塞依赖
Blocked by: Issue #1（已完成）

## 规划中的后续 Issues

| Issue | 内容 |
|-------|------|
| #2 | Persist live interview Q&A as Conversation Turns ← **当前** |
| #3 | Record key Session Events for traceability |
| #4 | Add FTS5 search across Conversation Turns |
| #5 | Support manual end and stale Session archival |
| #6 | Restore Sessions into Interview memory |
| #7 | Isolate Session persistence failures from live answering |
| #8 | Document Session Console API contracts |
| #9 | Verify Session backend end-to-end |

## 项目架构（当前状态）

```
Python (语音捕获)                      Node.js (AI 调度 + 持久化)
┌─────────────────┐                  ┌──────────────────────────┐
│ VAD → Whisper   │──stt_final──→    │ dataHandler.js            │
│ mic / loopback  │   HTTP POST      │  → answerInterviewQuestion│
└─────────────────┘                  │  → channel.service.js     │
                                     │  → SDK 工厂 → AI API     │
                                     │  → session.service.js     │
                                     │  → Socket.IO → HUD       │
                                     └──────────┬───────────────┘
                                                │
                                         ┌──────▼────────┐
                                         │ data/solvewatch│
                                         │ .db (SQLite)  │
                                         └───────────────┘
```
