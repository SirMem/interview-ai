# Task Plan: Multi-Channel AI Provider + Settings UI Overhaul

> 将 ccx-main 的 channel 调度模型搬到 solveWatchAi，替换扁平的 `.env` provider 配置为 `config/channels.json`，支持自定义 baseUrl、多 key 轮询、优先级调度、circuit breaker，并重构 settings 页面为 ccx-main 风格的添加/管理 channel UI。

## Current Phase
Phase 5 (Complete — all phases done)

## Phases

### Phase 1: 数据层 — channel.service.js + channels.json
- [x] 创建 `config/channels.json` 数据结构定义
- [x] 创建 `src/services/channel.service.js`:
  - [x] `loadChannels()` — 读取 channels.json，不存在时从 `.env` 自动迁移
  - [x] `saveChannels()` — 写回 JSON
  - [x] `getActiveChannels()` — 返回 status=active 并按 priority 排序
  - [x] `getNextChannel()` — 同 priority round-robin 轮询
  - [x] `recordFailure(channelName)` — 计数 + auto-pause（>=3 fail）
  - [x] `recordSuccess(channelName)` — 重置 fail 计数
  - [x] CRUD: add / update / delete
- **Status:** complete

### Phase 2: 协议层 — ai.service.js 重构
- [x] 将 `callOpenAI/callGrok/callClaude` 合并为通用 SDK 工厂
  - [x] `openai-compatible` → `new OpenAI({ apiKey, baseURL })`
  - [x] `anthropic` → `new Anthropic({ apiKey, baseURL })`
- [x] 替换 `callAIWithFallback` 的 `switch/case` → 从 channel.service 取 channels 调度
- [x] channel 参数透传：baseUrl → SDK baseURL、apiKey（轮询）、model
- [x] 移除 `callGrok` 和 `callGemini` 专用方法
- [x] 热重载支持（watch channels.json）
- [x] 兼容层：旧 `.env` 配置在 channels.json 不存在时自动创建
- **Status:** complete

### Phase 3: API 层 — channel.controller.js + channel.routes.js
- [x] 创建 `src/controllers/channel.controller.js`:
  - [x] `GET    /api/channels` — 列表
  - [x] `POST   /api/channels` — 添加
  - [x] `PUT    /api/channels/:name` — 更新
  - [x] `DELETE /api/channels/:name` — 删除
  - [x] `PATCH  /api/channels/:name/status` — pause/resume
  - [x] `POST   /api/channels/test` — 测试连通
  - [x] `GET    /api/channels/:name/models` — 拉模型列表
- [x] 创建 `src/routes/channel.routes.js` 注册路由
- [x] 挂在 Express app 上
- **Status:** complete

### Phase 4: 前端 — settings.html UI 改造
- [x] 当前 provider 卡片 → channel CRUD 管理界面
  - [x] 可拖拽排序的 channel 卡片列表（显示 name / serviceType / baseUrl / status）
  - [x] 状态标签：active（绿色）/ paused（黄色）/ disabled（灰色）
  - [x] 操作按钮：Test / Edit / Delete / Pause-Resume
- [x] 添加渠道弹窗（ccx-main style）
  - [x] Service Type 选择（openai-compatible / anthropic）
  - [x] Name（必填）
  - [x] Base URL（可选，空=官方默认）
  - [x] API Keys（多行文本，每行一个）
  - [x] Model（文本输入）
  - [x] Priority（数字，默认10）
- [x] 编辑渠道弹窗（复用添加表单）
- [x] 测试按钮 → 调用 /api/channels/test
- [x] 删除确认对话框
- [x] 拖拽排序自动持久化到后端
- **Status:** complete

### Phase 5: 集成测试与收尾
- [x] Node.js 服务启动自检：channels.json 存在性验证
- [x] 空 channels.json → 自动创建空的
- [x] 测试 channel CRUD：create / read / update / delete / pause/resume
- [x] 测试错误处理：重复名称、无效 serviceType、不存在的 channel
- [x] 测试向后兼容：旧的 `.env` 配置和 settings 页面仍然工作
- [x] 清理：测试数据已移除
- **Status:** complete

## Key Questions
1. ~~数据存储格式：`.env` 还是 JSON？~~ → 已决策：`config/channels.json`
2. ~~serviceType 怎么划分？~~ → 已决策：`openai-compatible` + `anthropic`
3. ~~Channel 包含哪些字段？~~ → 已决策：name + baseUrl + apiKeys + model + priority + status
4. ~~UI 风格？~~ → 已决策：ccx-main 风格（添加按钮 + 弹出表单）
5. ~~调度策略？~~ → 已决策：priority 排序 + 同 priority round-robin + circuit breaker

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| `config/channels.json` 存储 | JSON 支持数组/嵌套，比 `.env` 更适合表达多 key、多 baseUrl |
| 两种 serviceType | OpenAI-compatible 覆盖 OpenAI/Groq/Ollama/任何中转；Anthropic 独立协议 |
| priority + round-robin 调度 | 优先级控制流量权重，同优先级轮询实现负载均衡 |
| circuit breaker（3 fail → paused） | 防止死端点阻塞每次请求 |
| 自动从 `.env` 迁移 | 保证向后兼容，用户无感升级 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| — | 1 | — |

## Notes
- CONTEXT.md 和 ADR-0001 已经创建，记录了完整的设计决策
- 迁移脚本在 channel.service.js 内联实现（检测 channels.json 不存在时触发）
- Gemini 支持移除（实际未使用，可后续通过 openai-compatible 类型加回来）
