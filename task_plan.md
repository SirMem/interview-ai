# Task Plan: Stereo Mix Audio Source Support

> 支持在 settings 页面选择音频输入源（默认麦克风 / 立体声混音），让用户戴着耳机也能捕获面试官的声音。

## Current Phase
Phase 1

## Phases

### Phase 1: Python 层 — config + audio_recorder
- [ ] `transcriber/config.py` — 新增 `AUDIO_INPUT_SOURCE: str` 配置（从 `.env` 读取）
- [ ] `transcriber/audio_recorder.py` — `AudioRecorder.__init__` 接受 `device` 参数，`start_recording()` 传给 `sd.InputStream`
- [ ] `transcriber/main.py` — 新增 `GET /audio-devices` 端点，返回可用的输入设备列表
- **Status:** pending

### Phase 2: Node 层 — config controller + routes
- [ ] `src/controllers/config.controller.js` — getFullConfig / saveFullConfig 中读写 `audio_input_source` 字段（存到 `.env`）
- [ ] `src/routes/config.routes.js` — 新增 `GET /config/audio-devices`，代理 Python 转写器的设备列表
- **Status:** pending

### Phase 3: 前端 — settings.html 音频源下拉
- [ ] settings.html 加载时调用 `/api/config/audio-devices` 获取设备列表
- [ ] 渲染为 `<select>` 下拉框（显示设备名称 + 索引）
- [ ] 保存时写入 `audio_input_source`
- **Status:** pending

### Phase 4: 集成测试
- [ ] 启动 Python 转写器，测试 `/audio-devices` 返回设备列表
- [ ] 启动 Node，测试 settings 页面加载设备列表
- [ ] 切换音频源 → 重启 Python 转写器 → 验证使用新设备录音
- **Status:** pending

## Key Questions
1. 已决策：冷加载（保存后重启 Python 生效）
2. 待确认：设备列表通过 Node 代理 Python 端点获取

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 冷加载（重启生效）| 改动量小，音频设备切换不频繁 |
| Node 代理 Python `/audio-devices` | settings.html 只能调 Node API，Node 再转发给 Python |
| 用设备索引（int）存储 | sounddevice 使用设备索引选择设备，简单可靠 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| — | 1 | — |