# Findings & Decisions — Multi-Channel AI Provider

## Requirements
- 支持自定义 API baseUrl（中转站、自建代理）
- 支持多 API Key 轮询
- 支持优先级调度，同优先级 round-robin
- circuit breaker：连续失败 N 次后自动暂停
- settings 页面像 ccx-main 一样创建/管理 channel
- 向后兼容：从 `.env` 自动迁移到 `channels.json`

## Research Findings

### ccx-main UpstreamConfig 核心结构
- 每个 upstream 有 `baseUrl`, `apiKeys[]`, `serviceType`, `modelMapping`, `status`, `priority`
- 5 种 type：messages/chat/responses/gemini/images（solveWatchAi 简化到 2 种）
- POST `/api/messages/channels` 添加；PUT 更新；DELETE 删除
- 前端 `AddChannelModal.vue` 支持快速粘贴解析和详细表单两种模式
- `quickInputParser.ts` 能识别 20+ 平台的 API Key 格式

### solveWatchAi 当前 ai.service.js 调用链
- `callAIWithFallback()` → 按 order 数组遍历 providers → switch/case 分 5 种 provider
- 每个 `callXxx()` 都用对应 SDK 的默认 baseURL，不可自定义
- 失败跟踪：`failedProviders Map`，带退避时间（backoff），但不会自动 pause
- 配置来源：`.env` → `loadConfig()` → `this.config.keys/model/order/enabled`

### solveWatchAi 当前 settings.html 结构
- providers 渲染：循环 `providers[]`，每个显示 key 输入框 + model 下拉 + toggle + test
- save：`buildPayload()` 拼 JSON → `POST /api/config/full`
- config.controller.js 读写 `.env` 文件

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| `config/channels.json` 存 channel 配置 | JSON 数组自然表达多 key 和多 baseUrl，`.env` 做不到 |
| 2 种 serviceType | OpenAI/Groq/Ollama 全用 `openai` SDK 同一套协议，只是 baseUrl 不同；Anthropic 独立协议 |
| channel 最小字段集 | name + baseUrl + apiKeys + model + priority + status，够了 |
| ccx-main 风格 UI | 成熟的 pattern，"添加渠道"弹窗 + 可拖拽卡片列表 |
| circuit breaker 3 fail → paused | 和 ccx-main 的 auto-blacklist 类似但不自动恢复，保留手动恢复 |
| 自动迁移脚本 | 检测 channels.json 不存在时，从 `.env` 的 OPENAI_API_KEY 等字段创建默认 channel |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| — | — |

## Session History & Restore Decisions

### Core direction
- Borrow the conversation/session persistence ideas from Claude Code, Codex-style tools, and Hermes Agent, but do not copy a full agent framework.
- Model interview history as: append-only Session Events + structured Conversation Turns + short-term Interview memory.
- Real-time answering remains speed-first; persistence and retrieval must not block streaming answers.

### Session lifecycle decisions
| Decision | Rationale |
|----------|-----------|
| Session creation supports both manual start and automatic default creation after the first effective Q&A | Manual start is explicit; auto creation prevents data loss when the user forgets |
| Automatic title format: `Live Interview - YYYY-MM-DD HH:mm` | Avoids extra AI calls on the live path; user can rename later |
| Session end supports manual end plus automatic archival after 12 hours without new turns | Prevents stale active sessions without risking normal interview pauses |
| Manual restore reactivates ended Sessions | "Restore" means continue that Session; later a separate "Use as Context" action can borrow history without writing into the old Session |
| Manual restore loads exactly the recent 8 Conversation Turns | Fixed small context window keeps answers fast, cheap, and predictable |

### Conversation and event decisions
| Decision | Rationale |
|----------|-----------|
| `session_events` records only key lifecycle and processing-stage events | Provides traceability without storing high-frequency token or partial-STT noise |
| `conversation_turns` stores both `raw_transcript` and `cleaned_question` | Raw transcript supports STT debugging; cleaned question supports display, search, RAG, and review |
| `cleaned_question` falls back to `raw_transcript` when extraction fails | Prevents data loss and keeps every turn displayable |
| `answer` stores only the final answer body, not the `Q:` prefix | Question and answer are already separate fields; clean answer is better for display and retrieval |
| `turn_index` is computed from database `MAX(turn_index) + 1` per Session | Simple, reliable, and aligned with the durable source of truth |

### Storage decision
- First version stores SQLite at `data/solvewatch.db` and gitignores database files.
- This is intentionally simple for local development and can migrate to an Electron user data path when packaged.
- Use `better-sqlite3` for the first Node.js SQLite implementation because this is a local, single-user desktop app with light writes and simple reads.
- Create an FTS5 table in the first version for searching `cleaned_question`, `answer`, and `raw_transcript` across Conversation Turns.
- First version uses manual FTS synchronization: `appendTurn()` writes `conversation_turns` and then writes `conversation_turns_fts`; all turn writes must go through the Session service.

### Session service interface
First version Session service should be the only module that writes Session data. Proposed public interface:
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

First version keeps `activeSessionId` inside the Session service because SolveWatch AI currently has a single active interview flow and the goal is to ship quickly.

Session restore hydration happens in `dataHandler.js`: `sessionService.restoreSession(sessionId)` returns recent turns, then `dataHandler` clears and loads `InterviewTranscriptBuffer`. This keeps the Session service focused on durable storage while `dataHandler` owns live prompt memory.

After Session restore, the HUD only shows a restore status such as "8 turns loaded" and does not render historical Q&A. Historical detail belongs in the Console.

First version API split:
- REST for history/query: `POST /api/sessions`, `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/sessions/:id/turns`, `POST /api/sessions/:id/end`, `GET /api/sessions/search?q=...`
- Socket.IO for live state: `start_session`, `end_session`, `restore_session`, `session_started`, `session_ended`, `session_restored`

Rule of thumb: viewing history uses REST; changing the current live interview state uses Socket.IO.

Implementation scope decision: build the backend Session core first, then generate frontend development documentation from the backend API/contracts. Do not implement the Console UI yet because the Console frontend stack has not been finalized.

## Resources
- 已有文档：`CONTEXT.md`, `docs/adr/0001-multi-channel-ai-provider.md`
- 当前 config：`src/controllers/config.controller.js`（需要保留非 provider 部分）
- 当前 AI service：`src/services/ai.service.js`（需要重构 SDK 调用）
- 当前 settings UI：`src/public/settings.html`（provider 部分替换为 channel 管理）
- ccx-main 参考：`F:\solveWatchAi\ccx-main\backend-go\internal\config\config.go`（UpstreamConfig 结构）
- ccx-main 参考：`F:\solveWatchAi\ccx-main\frontend\src\components\AddChannelModal.vue`（UI 逻辑）
- ccx-main 参考：`F:\solveWatchAi\ccx-main\frontend\src\utils\quickInputParser.ts`（快速解析）
- ccx-main 参考：`F:\solveWatchAi\ccx-main\backend-go\internal\handlers\messages\channels.go`（API）
- ccx-main 参考：`F:\solveWatchAi\ccx-main\backend-go\internal\config\config_messages.go`（CRUD 方法）
