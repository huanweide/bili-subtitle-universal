# CHANGELOG

## 8.1.0 · 解决「音频解码失败（可能内存不足）」

- **【重大修复】decode 失败的根治方案**。v8.0 之前，`decodeAudioData` 一次性把 3 小时音频解成未压缩 PCM（44.1kHz 双声道 ≈ 3.8GB），遇到你看到的 `Unable to decode audio data（可能内存不足）`。现在加了**三层防护**：
  1. **MIME 误标自愈**：decode 前用魔数探针（ftyp/RIFF/EBML/OggS/ID3…）判真实容器，若与标注不一致用真实 MIME 重建 blob 重试一次。修复一类「服务端返回 m4a 但 Content-Type 错」导致的解码失败。
  2. **内存预检 + 策略化路由**：根据 `blob.size` 与预估码率算出 PCM 占用：
     - `auto`（默认）：预估 > 1GB 或源 > 120MB 自动走「播放录制」兜底，不再盲目 decode。
     - `decode`：始终 decode（最快，3 时长有 OOM 风险）。
     - `record`：始终播放录制（最稳，慢）。
  3. **错误分类友好文案**：解码失败提示具体原因（格式不受支持 / 文件损坏 / 内存不足），并提示已自动降级兜底。
- **【新增】播放录制兜底通道**（v8.0.0 缺失的第二条路径）。`recorderAsr()`：隐藏 `<audio>` 元素按倍速播放 → `captureStream()` 捕获 → 同上下文实时 AudioContext → `ScriptProcessor` 跨回调连续游标 → 最近邻降采样到 16kHz 单声道 → 攒片 → 转写 → 时间戳 ×倍速还原真实时间。
  - 内存 O(单片)，与视频总长无关，3 小时任意时长也能跑。
  - 倍速可设（2/4/8/16，默认 4 推荐平衡）。
  - 倍速未校准（极少见）：播放结束用 `cursorOrig vs totalDur` 对账，若偏差 >5% 线性修正全部时间戳。
  - 自动播放策略被浏览器拦截：自动出「▶ 解锁播放并继续」按钮，用户点一下即可。
  - 片超限自动对半拆小转写。
- **【新增】设置 UI 两个新选项**：「超长视频策略（解码兜底）」「播放录制倍速」。
- **【新增】Node 单测 + 浏览器灰度 + 真实 API 冒烟**：
  - Node：`tests/run-tests.js` 扩到 **29 项全绿**（新增 probeMime 6 例、estimateDecodedMB、shouldUseRecord 4 例）。
  - 浏览器：`tests/test.html` 灰度新增 **7 项**（设置控件存在 / decode 损坏抛错 / probeMime null / MIME 自愈 / captureStream 行为）。
  - 真实 SF key 冒烟：`tests/sf-smoke.js` → HTTP 200，端点 + 鉴权 + 模型通。
- **【新增】sf-smoke 冒烟脚本**（仓库随走，复用仅从环境变量 `SILICONFLOW_API_KEY` 读取，绝不硬编码）。
- 状态/阶段文案细化：录制中 phase 显示「🎧 播放录制兜底中（4 倍速，约 X 分钟，可最小化页面）」+ 进度按 `currentTime/totalDur` 实时更新。

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