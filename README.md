# 全网视频字幕提取 · AI 转写版

> 纯油猴脚本 · 零安装 · 零后端 · 一条脚本搞定「全网视频字幕提取 + 无字幕 AI 转写」，B 站 WBI 官方字幕 / YouTube 字幕 / 任意站点的 `<track>` WebVTT 全支持，无字幕时自动调用硅基流动 SenseVoice 云端转写，**MIME 自愈 + 内存预检 + 播放录制兜底**，3 小时长音频稳得离谱。

## 为什么是「独一家」

| 项目 | 形态 | 短板 |
|---|---|---|
| 各 B 站油猴脚本 | 纯油猴 | 只 B 站、**无字幕就傻眼**，不做 ASR |
| Python CLI（video-captions / biliSub） | CLI | 要装 Python + ffmpeg + GPU |
| Chrome 扩展（视频转文字助手 / LiveCaption） | 扩展 | 要装 Native Host / Ollama 后端 |
| 本地 Whisper 类（SubExtractor / xignoe） | 扩展 | 要下 80–250MB 模型、吃内存 |

**我们的组合拳**：纯油猴 + 零后端 + 零本地模型，同时覆盖「有字幕」+「无字幕」两种情况，且全网通用。

## 核心特性

1. **B 站官方字幕**：WBI 签名稳定，多语言自动选优（人工字幕 > AI 字幕；中文 > 英文 > ...），自动跟 P 切、登录态取 AI 字幕。
2. **YouTube 字幕**：解析 `ytInitialPlayerResponse` 中的 caption tracks，自动取 TTML，含自动字幕（kind=asr）标识。
3. **通用 HTML5**：自动扫描页面 `<video>` 的 `<track kind="subtitles|captions">` 拿 WebVTT；`<video src>` 是直链时可直接 AI 转写音频。
4. **AI 语音转写（无字幕兜底，三层防线）**：
   - 整段直传：≤40MB 音频直接给 SenseVoice（原始 m4a，快）。
   - 分片转写：大文件 `decodeAudioData` 解码 + `OfflineAudioContext` 同上下文重采样到 16kHz 单声道 → 切片 → 转写 → 拼接时间戳。
   - **🆕 v8.1 三层防线**根治你看到的 `Unable to decode audio data（可能内存不足）`：
     - **① MIME 误标自愈**：魔数探针（ftyp/RIFF/EBML/OggS/ID3…）判真实容器，不一致自动重建 blob 重试。
     - **② 内存预检 + 策略化路由**：预估 PCM 占用 > 1GB 或源 > 120MB 自动走「播放录制」兜底；可在设置里选 auto / decode / record。
     - **③ 播放录制兜底**：隐藏 audio 倍速播放 + `captureStream` + 同上下文实时 AudioContext + 跨回调游标降采样 16kHz → 攒片 → 转写。内存 O(单片)，3 小时不 OOM。倍速 2/4/8/16 可调，结束自动对账修正时间轴。自动播放被拦截给「▶ 解锁」按钮。
   - 流水线：转写第 N 片的同时预渲染第 N+1 片，省时间。
   - 单片超限自动对半拆小递归。
   - 进度可视化：下载进度条 + 分片状态（✓ / ⏳ / ✗）+ 预计剩余时间 + 可取消。
5. **可选翻译**：硅基流动 Qwen/DeepSeek 批量翻 120 条/批。
6. **多格式导出**：TXT（纯文本）/ SRT（带时间戳）。
7. **SPA 兼容**：B 站切 P、YouTube 切视频自动重新解析（轮询 URL + `yt-navigate-finish` 事件）。

## 安装

1. 浏览器装 **Tampermonkey**（Edge / Chrome / Firefox 都有，Edge 商店搜「Tampermonkey」一键装）。
2. 打开 `bili-subtitle.user.js`，把整个文件内容粘贴到 Tampermonkey「新建脚本」编辑框，保存即可。
3. 或者托管到 GitHub 后用「从 URL 安装」。

首次安装会在 B 站 / YouTube / 任意带 `<video>` 的页面右下角出现 🎬 悬浮按钮。纯文字页面不出现，不打扰。

## 使用

1. 打开任意带视频的网页。
2. 点右下角 🎬。
3. 点「⚡ 获取字幕」：自动判站点，有官方字幕就秒提，无字幕就 AI 转写。
4. 复制 / 下载 TXT / 下载 SRT，一键搞定。

## 设置（⚙）

| 选项 | 作用 |
|---|---|
| 硅基流动 API Key | AI 转写 + 翻译都靠它。cloud.siliconflow.cn 注册即送额度 |
| 无字幕时 AI 语音转写 | 关掉则无字幕时只给提示，不自动转写 |
| 字幕获取失败时自动转写 | 官方字幕接口失败兜底 |
| 始终使用音频转写 | 无视视频自带字幕（适合字幕损坏的 UP 主视频） |
| 转写语言 / 转写模型 | auto / SenseVoiceSmall（快）/ SenseVoiceLarge（更准） |
| 分片时长 | 5/10/15/20 分钟，3 小时长视频可设 20 |
| 翻译为 / 翻译模型 | 不翻 / 中文 / 英文 / ... × Qwen2.5-72B/7B / DeepSeek-V3 |

API Key 输入框有 👁 切换显示/隐藏。

## 音频管线原理（大白话）

旧版用「让 `<audio>` 元素以 16 倍速跑 + 把实时 AudioContext 的源塞进 OfflineAudioContext 抓音频」—— **这条路根本走不通**。两个 AudioContext 不是一家人，Web Audio 明确规定「节点只能连同一个 context 的节点」，所以一连就报 `cannot connect to an AudioNode belonging to a different audio context`。而且就算能连，离线渲染也不能让媒体元素加速跑，抓出来还是快进音，转转写也听不懂。

新版路线（已通过真实 Chromium 灰度测试）：

```
下载 m4a blob
   ↓
blob → arrayBuffer
   ↓
decodeAudioData 一次性解码成 AudioBuffer
   ↓
每一片 [start, start+dur)：
   new OfflineAudioContext(1, ceil(dur×16000), 16000)
   createBufferSource(buf) → start(0, start, dur) → startRendering
   （节点与 destination 同属一个 OfflineAudioContext，合法 + 离线渲染极快）
   ↓
渲染结果 → 16bit PCM WAV blob → 硅基流动 SenseVoice → SRT
   ↓
按 (i*chunkDur) 偏移回真实时间戳 → mergeBodies
```

整段 ≤ 40MB 还可走「整段直传」捷径（不解码直接传原始 m4a 给模型）。

## 常见问题

- **提示「未配置硅基流动 API Key」**：去 cloud.siliconflow.cn 注册拿 `sk-...` 填到设置里。
- **3 小时长视频转写中途报错**：可能是音频解码内存吃紧（罕见，浏览器标签 OOM）。把分片时长调到 10 分钟、或换 Chrome / Edge 最新版重试。
- **YouTube 无字幕转写失败**：YouTube 音频是流媒体签名分片，需要解 cipher 才能下载，目前脚本提示「请使用 YouTube 自动字幕」。自动字幕本身已被脚本自动抓取。
- **MSE / blob: 视频无法转写**：这是浏览器 MSE 保护设计，没直链 URL，无法直接下载音频。

## 开发

```bash
node tests/run-tests.js                  # 单元测试：MD5/WBI/SRT/VTT/WAV/MIME/内存预估/策略判断（29 项）
node tests/serve.js                      # 静态服务，端口 8765
SILICONFLOW_API_KEY=sk-... node tests/sf-smoke.js   # 真实 API 冒烟（仅从 env 读 key，不入仓库）
```

灰度测试：`http://127.0.0.1:8765/tests/test.html`，用真实 Chromium 打开验证 UI / 音频管线 / **解码失败降级 / MIME 自愈 / captureStream 出声**。

## 版本

当前 **8.1.0**（v8 → v8.1：解决「音频解码失败（可能内存不足）」，MIME 自愈 + 内存预检 + 播放录制兜底 + 真实 SF key 冒烟）。

## 许可证

MIT