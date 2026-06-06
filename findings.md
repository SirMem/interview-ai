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
