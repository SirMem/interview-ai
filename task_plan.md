# Task Plan: SolveWatch AI —— 从"语音转写管道"到"AI Agent 框架"

> 当前状态：基础设施已就绪（channel 调度 + WASAPI loopback + 多 channel UI），
> 核心 AI 调用层仍然是"一次 question → 一次 AI → 一次 answer"的简单管道。
> 下一步是引入 session 管理、RAG、工具调用、技能系统，使面试助手具备 Agent 能力。

## Current Phase
Base Complete (所有基础管线就绪)

## 已完成的工作

### Multi-Channel AI Provider (已合入 main)
- `config/channels.json` — JSON 存储替代扁平 `.env`
- `channel.service.js` — CRUD + priority 排序 + round-robin + circuit breaker
- `ai.service.js` — SDK 工厂（openai-compatible / anthropic）
- `channel.controller.js` + routes — REST API
- `settings.html` — ccx-main 风格 channel 管理 UI（拖拽排序、添加/编辑弹窗、状态切换、测试）
- 移除了 Groq、Gemini 独立 SDK 调用

### WASAPI Loopback 系统音频捕获 (已合入 main)
- `system_audio_capture.py` — pyaudiowpatch WASAPI loopback 封装
- `always_on_listener.py` — 双路径（mic / system audio）
- settings.html 音频源切换（麦克风 / 系统音频）
- 前两次 Stereo Mix 尝试被废弃

### DeepSeek 推理模型修复 (已合入 main)
- 流式响应中 fallback `delta.reasoning_content`（推理模型特有）

### Ollama 已完全移除 (已合入 main)
- `ai.service.js`: 删除 callOllama / _streamOllama / _callOllamaClassifier / summarizeQAPair / summarizeMerge
- `config.controller.js`: 删除 ollama provider 枚举、模型获取、测试端点
- `InterviewTranscriptBuffer.js`: 从 210 行简化到 65 行（纯 rolling Q&A storage，无压缩/摘要）
- `dataHandler.js`: 删除 setSummarizeFn 绑定

### Channel 状态切换按钮 (已合入 main)
- `settings.html` channel card 新增 pause/resume toggle 按钮

## 项目当前架构

```
Python (语音捕获)                      Node.js (AI 调度 + HUD)
┌─────────────────┐                  ┌──────────────────────────┐
│ VAD → Whisper   │──stt_final──→    │ dataHandler.js            │
│ mic / loopback  │   HTTP POST      │  → answerInterviewQuestion│
└─────────────────┘                  │  → channel.service.js     │
                                     │  → SDK 工厂 → AI API     │
                                     │  → Socket.IO → HUD       │
                                     └──────────────────────────┘
```

## 当前局限性

| 维度 | 现状 | 目标 |
|------|------|------|
| 对话记忆 | 最近 N 条 Q&A 原文注入（无压缩） | Session 管理 + 持久化 |
| 检索增强 | 无 | RAG（历史 + 知识库）|
| 工具调用 | 无 | function calling |
| 技能系统 | interview-answer-prompt.txt × 1 | 多预设技能切换 |
| Agent 循环 | 一次调用 | 多轮自查/反思 |

## 规划中的下一代

见后续讨论（搬运 openclaw/hermes 等 Python agent 框架的架构模式）。
