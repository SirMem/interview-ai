# Task Plan: 捕获系统音频（微信通话等）用于面试 AI 助手

> 在 Windows 面试场景下，戴着耳机听面试官说话时，麦克风收不到对方声音。
> 需要捕获"系统正在播放的音频"（扬声器输出）——包括微信/Zoom/腾讯会议等 VoIP 通话。
> 目标：让 Python 转写器能读取系统音频流，不依赖麦克风。

## Current Phase
Phase 2 — 方案调研与重定向

## Phases

### Phase 1（已完成，已废弃）: Stereo Mix 方案
- [x] `config.py` — 新增 `AUDIO_INPUT_SOURCE` + `get_audio_input_device()` 函数
- [x] `always_on_listener.py` / `deepgram_listener.py` — 按名称查找设备 + 动态声道数
- [x] `main.py` — 新增 `/audio-devices` 端点 + sd.rec 传 device
- [x] `config.controller.js` — 读写 `audio_input_source`
- [x] `config.routes.js` — 代理 `/config/audio-devices`
- [x] `settings.html` — 音频源下拉框（按名称存储）
- **Status:** 已完成并合入 main
- **结论:** ❌ Stereo Mix 依赖声卡驱动，设备索引漂移，实际不可用（`PaErrorCode -9996`）

### Phase 2: 方案调研
- [x] 确认 Stereo Mix 失败原因（设备索引漂移 + channels 不匹配）
- [x] 调研替代方案：
  - **VB-Cable**（虚拟声卡，零代码改动，收费 $40）
  - **pyaudiowpatch**（WASAPI loopback，需改捕获路径）
  - **soundcard**（新捕获路径）
- **Status:** 待决策
- **结论:** 有三个候选方案，待选一个实现

## Key Questions
1. ~~Stereo Mix 能直接用吗？~~ → ❌ 不可靠，设备名编码 + 索引漂移
2. 替代方案选哪个？（待决策）

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| ~~Stereo Mix~~ | ❌ 实施后发现不可靠 |
| ~~用设备索引存~~ | ❌ 重启漂移 |
| ~~用设备名称存~~ | ❌ 中文编码问题 + 设备名可能不存在 |
| — | — |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `Invalid device [PaErrorCode -9996]` | Stereo Mix 设备索引漂移 | 改为按名称查找（但中文名有编码风险）|
| `Invalid number of channels [PaErrorCode -9998]` | 写死 channels=1 | 改为动态 max_input_channels（治标不治本）|
| Stereo Mix 在设备管理器中不存在 | 设备列表无此设备 | 根本原因是声卡驱动不提供 Stereo Mix |

## 候选方案对比

| 方案 | 代码改动 | 所需安装 | 稳定性 | 成本 |
|------|---------|---------|--------|------|
| **VB-Cable** ⭐ | 零改动 | VB-Cable 虚拟声卡 | ✅ 极高 | $40 / 免费版≤10min |
| **pyaudiowpatch** | 中等 → 新增捕获路径 | `pip install pyaudiowpatch` | ✅ 高 | 免费 |
| **VoiceMeeter Banana** | 零改动 | 虚拟调音台 | ✅ 高 | 免费/捐赠 |

## Notes
- 先有 `8135435` `ed21fb7` 两次 Stereo Mix 提交
- VB-Cable 本质是虚拟声卡：系统音频输出 → VB-Cable → 显示为普通输入设备 → sd.InputStream 无感使用
- pyaudiowpatch 直接 WASAPI loopback：不走虚拟设备，直接从扬声器偷听
