# CHANGELOG

## 8.0.0 · 全网通用 + 音频管线重写

- **【重大修复】音频管线彻底重写**。v7.x 用「MediaElementSource 实时 AudioContext 跨接 OfflineAudioContext」抓音频 —— Web Audio 不允许跨上下文连接，因此长视频转写报 `cannot connect to an AudioNode belonging to a different audio context`。
  - 新路线：blob → `decodeAudioData` 整体解码 → 每片用 `OfflineAudioContext` 同上下文 `createBufferSource` 重采样到 16kHz 单声道 → `wavFromBuffer` 转 WAV → 逐片 SenseVoice 转写。
  - 离线渲染快且合法，3 小时长视频可稳定跑通。
  - 流水线：转写第 N 片的同时预渲染第 N+1 片。
  - 单片超限自动对半拆小递归。
- **【重大新增】全网通用**。@match 改为 `*://*/*`，引入站点适配器架构：
  - `bilibili`：完整 WBI 官方字幕 + 音频转写。
  - `youtube`：解析 `ytInitialPlayerResponse` caption tracks → TTML，含自动字幕标识；音频转写暂不支持（流媒体签名）。
  - `html5`：自动抓 `<video>` 的 `<track>` WebVTT；直链 src 可 AI 转写；MSE/blob 提示用户。
- **【优化】无字幕逻辑**：明确「ℹ 本视频无字幕，点击下方『AI 转写』可语音生成字幕」提示；新增独立的「🎙 AI 转写」按钮，无字幕时一键手动触发（不必去设置）。
- **【优化】设置 UI**：API Key 加 👁 切换显示/隐藏；新增「转写模型」单独选择（SenseVoiceSmall / SenseVoiceLarge）；面板标题保留视频标题。
- **【优化】代码逻辑**：站点适配器解耦；纯函数抽离便于单测；WBI 签名完全保留并验证（MD5 已知向量 3 个 + w_rid 结构 + wts）。
- **【新增】测试基建**：`tests/run-tests.js`（从真实源码大括号配对提取纯函数测，18 项全绿，含 MD5/时间戳/SRT/VTT/TTML/WAV 头/合并去重）；`tests/serve.js` + `tests/test.html` + 两张灰度截图（真实 Chromium 验证 UI 渲染 + 音频管线 8 项 PASS，**真实跑过 renderChunk 无 cross-context 错误**）。
- **【合规】@connect `*`**：通用适配器需跨域取任意站点 track/audio，已加（Tampermonkey 会弹权限确认）。

## 7.2.0 · B 站专用字幕 + 硅基流动 ASR 兜底

- B 站 WBI 签名取字幕。
- 无字幕自动硅基流动 SenseVoice 转写（含整段直传 / 分片自适应）。
- 翻译、复制、TXT/SRT 下载、SPA 切 P 检测。