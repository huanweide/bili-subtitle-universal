# bili-subtitle-universal 审计报告：AI 模型兼容性 + UI 死重

- 审计对象：`bili-subtitle.user.js` v9.16.1（单文件 IIFE，4838 行）
- 审计日期：2026-10-18
- 审计边界：**只出报告，未修改任何仓库源码，未 git commit / push**
- 取证脚本（新增，非源码）：`scripts/verify/ai-probe.js`、`scripts/verify/mock-server.js`、`scripts/verify/ui-deadcss.js`、`scripts/verify/settings-scan.js`
- 证据文件：`scripts/verify/shots/mock-stdout.txt`（真实抓到的 HTTP 请求）、`shots/probe-report.txt`、`shots/openrouter-model-check.txt`、`shots/openrouter-stt-models.txt`

---

## 摘要表（按严重度排序，每条一行）

| # | 级别 | 线 | 位置 | 一句话 |
|---|------|----|------|--------|
| A1 | P0 | 模型 | `bili-subtitle.user.js:2460` | 硅基流动预设模型 `FunAudioLLM/SenseVoiceLarge` 官方不存在，选了必失败 |
| A2 | P0 | 模型 | `:2538` | `response_format:'srt'` 无条件发送，SiliconFlow/OpenAI-4o 系/OpenRouter 三方都不成立 |
| A3 | P0 | 模型 | `:2564-2573` + `:2649-2653` | 无任何 `{"text":...}` JSON 兜底，JSON 响应会被当文本切分出"伪时间戳字幕"，且静默 |
| A4 | P0 | 模型 | `:4425-4430`, `:4404-4424` | 切换厂商不重置模型名，拿 A 家模型名打 B 家（有抓包证据） |
| A5 | P1 | 模型 | `:3389`, `:3395` | aiChat 不设 max_tokens、不查 finish_reason，长批翻译被截断会静默丢行 |
| A6 | P1 | 模型 | `:2378`, `:2646` | `MAX_SINGLE=40MB` 高于 OpenAI/OpenRouter 官方 25MB，25~40MB 直传必 413，白传几十 MB |
| A7 | P1 | 模型 | `:2481-2488` | OpenRouter 标 `supportsAudio:false` 与事实不符（实测有 26 个 STT 模型） |
| A8 | P1 | 模型 | `:2479` | DeepSeek 预设 `deepseek-chat`/`deepseek-reasoner` 已不在官方在售模型列表 |
| A9 | P1 | 模型 | `:2487` | OpenRouter 预设 `anthropic/claude-3.5-haiku`、`google/gemini-flash-1.5` 实测已下线 |
| A10 | P1 | 模型 | `:2500-2502`, `:2541` | 自定义厂商 base 留空 → 拼出相对路径 `/audio/transcriptions`，打到当前页面域名 |
| A11 | P1 | 模型 | `:2504-2510` | 自定义音频端点允许填完整 URL → 拼成 `base + '/' + 'https://...'` 畸形 URL（有抓包证据） |
| A12 | P1 | 模型 | `:2536-2537`, `:2548` | 硅基流动官方契约无 `hotwords` 参数；降级正则过宽会误伤"模型名无效" |
| A13 | P2 | 模型 | `:4343-4365` | 「测试连接」用 GET {base}/models 判 Key 有效，跨厂商有偏差 + 只看状态码会误报 |
| A14 | P2 | 模型 | `:4091`, `:2500-2501` | 自定义 base 缺 `/v1` 不校验，只在 label 里提示，404 才暴露 |
| A15 | P2 | 模型 | `:2534` | 硅基流动不声明 `language` 参数仍照发；粤语 `yue` 对部分后端无效 |
| A16 | P2 | 模型 | `:2557`, `:3398` | 401/402/429 直接把英文响应体截断 160 字符丢给用户，无中文兜底文案 |
| B1 | P1 | UI | `:3879-3894`, `:3946-3953` | 权重面板整块死 CSS（`.bsr-wbox`/`.bsr-wval`/`.bsr-wpresets`/`.bsr-wpreset-tip`） |
| B2 | P1 | UI | `:3874-3875`, `:3944` | `.bsr-res-r`（评分理由）死 CSS，卡片从不渲染 |
| B3 | P1 | UI | `:4454` vs `:4455-4460`；`:4681` | 注释宣称"第一次点展开评分理由"，实现里该功能已被删，注释撒谎 |
| B4 | P1 | UI | `:3552-3563`, `:4685` | 搜索结果排序依据对用户不可解释，"可解释评分引擎"卖点完全不可见 |
| B5 | P2 | UI | `:4669` | 语言下拉里的 `×3段`、`AI` 是内部技术话术，普通用户看不懂 |
| B6 | P2 | UI | `:4022-4028` | `⬇ TXT` / `🤖 AI 文本` / `⏱ 锚点稿` 命名歧义，区别只藏在 title 里 |
| B7 | P2 | UI | `:4029`, `:4166` | `✨ AI 纠错` 需"设置勾选+填Key+保存"才出现，面板无任何引导 |
| B8 | P2 | UI | `:2605`, `:2767`, `:4236-4244` | `ASR·缓存`/`ASR·取消` 内部状态串直接进界面与导出文件名 |
| B9 | P2 | UI | `:4125-4144` | 「分片时长/超长视频策略/播放录制倍速」三项音频内部细节平铺，撑长设置面板 |
| B10 | P2 | UI | `tests/test-ui.js:70-74` | 测试把死 CSS 选择器钉成契约，阻止清理 |
| B11 | P2 | UI | `:4695-4696` | 「无字幕·需转写」徽章承诺了未配 Key 时做不到的事 |

**排除项（明确查过、没问题）**：
- 无 Tailwind `hidden md:*`、无 `@media` 断点，面板 `max-width:calc(100vw - 32px)` 自适应 → **不存在"移动端直接消失"的入口**。
- 无"只写不读"的设置项：26 个 SETTINGS 键逐一键扫，读取次数均 ≥3 且含真实功能读取（见 `settings-scan.js` 输出）。
- `@connect *`（`:25`）已覆盖自定义端点跨域 → 自定义厂商不会被油猴拦截。
- `aiBaseUrl` 去尾斜杠 + `aiEndpointPath` 去首斜杠 → **不会拼出双斜杠**（用例9 已验证）。
- DeepSeek/OpenRouter 点转写会走 `runAsr` 前置拒绝（`:2594-2597`）并给中文提示，`asrNote` 也有说明（`:4421`）→ 能力标记"诚实"这点除 A7 外达标。
- `.bsr-tier` 已不存在（团队提到过的旧死 CSS 已清理）。

---

# 第一节 · AI 厂商 / 模型兼容性

## A1 · P0 · 硅基流动预设模型 `FunAudioLLM/SenseVoiceLarge` 官方不存在

- **位置**：`bili-subtitle.user.js:2460`
- **现象**：`asrModels: ['FunAudioLLM/SenseVoiceSmall', 'FunAudioLLM/SenseVoiceLarge']`，第二项即该值，`refreshProviderUI()` 把它填进 `#bsrAsrModelList` 供用户点选（`:4415`）。
- **契约核对**：SiliconFlow 官方文档 `POST /v1/audio/transcriptions` 的 `model` 枚举**只有两项**：`FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR`（<https://docs.siliconflow.com/cn/api-reference/audio/create-audio-transcriptions>）。
- **为什么是缺陷**：用户照着下拉点第二项 → 400/404「model not found」，且报错是英文截断体（A16），不知道是模型名选错。
- **建议**：删掉 `SenseVoiceLarge`；若要保留两个选项，换成 `TeleAI/TeleSpeechASR`。更稳的做法是切换厂商时 `GET /v1/models` 拉实时清单填 datalist。

## A2 · P0 · `response_format: 'srt'` 三家都不成立

- **位置**：`:2538`（`fd.append('response_format', 'srt');`，无条件追加）
- **契约核对**：
  - **SiliconFlow**：官方 body 只声明 `file`、`model` 两个参数，响应固定为 `{"text": "..."}` JSON。**`response_format` 未出现在任何官方契约里**，属未承诺行为。
  - **OpenAI**：官方文档明确「For **gpt-4o-transcribe** and **gpt-4o-mini-transcribe**, the only supported format is **json**」；只有 `whisper-1` 支持 srt/vtt。
  - **OpenRouter**：官方明确「**No SRT/VTT output** — srt, vtt, and text response formats are rejected with a 400」，只接受 `json` / `verbose_json`。
- **抓包证据**（`shots/mock-stdout.txt:86-104`，OpenAI 预设 + `gpt-4o-mini-transcribe`）：
  ```
  POST /v1/audio/transcriptions HTTP/1.1
  ------formdata-undici-097975454573
  Content-Disposition: form-data; name="model"

  gpt-4o-mini-transcribe
  ------formdata-undici-097975454573
  Content-Disposition: form-data; name="response_format"

  srt
  ```
- **为什么是缺陷**：三个厂商里两个明确 400，一个不承诺 → 转写直接失败或静默退化（见 A3）。
- **建议**：按 provider+model 能力表决定：`whisper-1` → `srt`；`gpt-4o*-transcribe` / OpenRouter / SiliconFlow → 不发送，改用 `verbose_json` 拿 `segments`，或按 A3 兜底取 `text`。

## A3 · P0 · 没有 `{"text": ...}` JSON 兜底 → 生成"伪时间戳字幕"且静默

- **位置**：`:2564-2573`（`transcribeWav`）、`:2649-2653`（整段直传）、`:2749-2750`（分片）
- **现象链**：
  1. `transcribeWav` 只对 `j.error` 做处理，其余 JSON **原样返回字符串**；
  2. `parseSrt(text)` 对 `{"text":"..."}` 返回 `[]`；
  3. `if (!segs0.length) segs0 = splitTextByTime(text0, 0, dur0 || 1);`（`:2653`）
  4. `splitTextByTime`（`:2364-2376`）按标点把**整段 JSON 原文**切句，再在 0~时长内**均匀铺开**时间戳。
- **为什么是缺陷**：用户拿到的是"每条都有时间戳"的字幕，但时间戳是算出来的、正文里混着 `{"text":"` 之类的 JSON 碎片 —— 静默产出错误结果，比报错更糟。
- **触发面**：SiliconFlow（官方响应就是 JSON）、绝大多数自定义 OpenAI 兼容端点（默认 json）、OpenRouter（强制 json）。
- **建议**：`transcribeWav` 里若解析出 `j.text`，直接返回 `j.text`（走兜底切分），并给 `state.lan` / toast 标注"该模型未返回时间戳，时间为均匀估算"。

## A4 · P0 · 切换厂商不重置模型名，拿 A 家的模型名打 B 家

- **位置**：`:4425-4430`（`#bsrAiProvider.onchange` 只调 `refreshProviderUI()` + `saveSettings()`）；`refreshProviderUI()`（`:4404-4424`）只改 datalist、label、提示，**从不改 `#bsrAsrModel` / `#bsrTModel` 的 value**
- **默认值**：`:1512` `asrModel='FunAudioLLM/SenseVoiceSmall'`、`:1516` `translateModel='Qwen/Qwen2.5-72B-Instruct'`
- **抓包证据**（`shots/mock-stdout.txt:107-137`，已切到 OpenAI 预设、模型输入框未动）：
  ```
  POST /v1/audio/transcriptions HTTP/1.1
  authorization: Bearer sk-TEST-KEY
  Content-Disposition: form-data; name="model"

  FunAudioLLM/SenseVoiceSmall      ← 打给 OpenAI 的模型名
  ```
- **为什么是缺陷**：切 OpenAI → 转写 404 `model does not exist`；切 DeepSeek/OpenRouter → 翻译 400 未知模型。用户会以为"这个厂商不能用"。
- **建议**：`onchange` 时把 `#bsrAsrModel` 刷成 `p.asrModels[0]`、`#bsrTModel` 刷成 `p.chatModels[0]`（自定义厂商留空），并 toast「已为你换成 xxx」。

## A5 · P1 · aiChat 不设 max_tokens、不查 finish_reason，长批翻译截断会静默丢行

- **位置**：`:3389` 请求体 `{model, messages, temperature}`，无 `max_tokens`；`:3395` 只取 `choices[0].message.content`，不读 `finish_reason`
- **现象**：`:3422` `BATCH = 120`，一次把 120 条字幕 + prompt 塞进去，模型输出触顶被截断 → `parseTranslations`（`:3405-3417`）按行切，`arr.slice(0, expected)` → 少行不报错，字幕凭空少一截。
- **为什么是缺陷**：丢内容不报错，用户以为翻完了。
- **建议**：加 `max_tokens`；`finish_reason === 'length'` 时把批次对半拆了重发。

## A6 · P1 · `MAX_SINGLE = 40MB` 高于官方 25MB 限制

- **位置**：`:2378` `var MAX_SINGLE = 40 * 1024 * 1024;`、`:2646` `if (blob.size <= MAX_SINGLE)`
- **契约核对**：OpenAI「File uploads are currently limited to **25 MB**」；OpenRouter multipart「limited to **25 MB**」；SiliconFlow「时长不超过 1 小时、大小不超过 **50MB**」。
- **为什么是缺陷**：25~40MB 的音频直传 OpenAI/OpenRouter 必 413，白白上传几十 MB 后才回落分片路径（`:2655-2658` 只 log 不提示）。另外 SiliconFlow 还有"单文件 ≤1 小时"限制，直传长音频同样会先失败一次。
- **建议**：`MAX_SINGLE` 按厂商取值（OpenAI/OpenRouter 25MB、SiliconFlow 50MB 且校验时长 ≤1h），超了直接走分片，别先撞一次。

## A7 · P1 · OpenRouter `supportsAudio: false` 与事实不符，能力被埋

- **位置**：`:2481-2488`（`audio: null, supportsAudio: false`）
- **契约核对**：OpenRouter 官方文档有 `POST /api/v1/audio/transcriptions`，且支持 OpenAI 风格 multipart（`-F file=@audio.wav -F model=openai/whisper-large-v3`）。
- **实测证据**（`shots/openrouter-model-check.txt`，`GET https://openrouter.ai/api/v1/models?output_modalities=transcription`）：返回 **26 个 STT 模型**，含 `openai/gpt-transcribe`、`qwen/qwen3-asr-1.7b`、`mistralai/voxtral-mini-3b-2507` 等。完整清单见 `shots/openrouter-stt-models.txt`。
- **为什么是缺陷**：`:4421` 会给用户显示「（该厂商不支持语音转写，仅翻译可用）」——**这句话是错的**；用户明明有 OpenRouter Key 却被挡在转写门外。
- **建议**：改 `supportsAudio: true`、`audio: '/audio/transcriptions'`，`asrModels` 填实时/常用 STT 模型；同时必须处理 A2（OpenRouter 拒绝 srt）。
- **待确认**：`openai/whisper-large-v3` / `openai/whisper-1` 未出现在 `output_modalities=transcription` 的前 15 条里（清单共 26 条，已全部落盘），是否仍在售需查完整清单或用真实 Key 试一次。

## A8 · P1 · DeepSeek 预设模型名已不在官方在售列表

- **位置**：`:2479` `chatModels: ['deepseek-chat', 'deepseek-reasoner']`
- **契约核对**：DeepSeek 官方 Models & Pricing 当前只有 **`deepseek-flash`** 与 **`deepseek-v4-pro`**（并注明 legacy 名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍被接受但对应模型已退役）。`deepseek-chat` / `deepseek-reasoner` 未出现在该页。
- **为什么是缺陷**：预设推荐的是文档时代遗留名；一旦别名彻底停用，选 DeepSeek 翻译直接 400。
- **建议**：改为 `deepseek-flash` / `deepseek-v4-pro`；更稳的是切到 DeepSeek 时 `GET https://api.deepseek.com/models` 拉实时清单。
- **待确认**：`deepseek-chat`/`deepseek-reasoner` 目前是否仍作为兼容别名可用（官方页面未列出）。验证方式：拿真实 Key 打一次 `POST https://api.deepseek.com/v1/chat/completions`，body 用 `deepseek-chat`，看是否 200。

## A9 · P1 · OpenRouter 两个 chat 预设模型实测已下线

- **位置**：`:2487` `['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct']`
- **实测证据**（`shots/openrouter-model-check.txt`，`GET https://openrouter.ai/api/v1/models`）：
  ```
  EXISTS   openai/gpt-4o-mini
  MISSING  anthropic/claude-3.5-haiku     → 现存 anthropic/claude-haiku-4.5 / claude-haiku-5.5
  MISSING  google/gemini-flash-1.5        → 现存 google/gemini-3.8-flash / 3.7-flash / 3.6-flash
  EXISTS   meta-llama/llama-3.1-8b-instruct
  ```
- **为什么是缺陷**：4 个预设里 2 个点了就是 "No endpoints found" / 404。
- **建议**：换成现存 id；长期方案是切厂商时 `GET https://openrouter.ai/api/v1/models` 实时填充 datalist（该接口免 Key）。

## A10 · P1 · 自定义厂商 base 留空 → 拼出相对路径 URL，报错还指向网络

- **位置**：`:2500-2502` `aiBaseUrl()`、`aiBaseUrl() + '/' + aiEndpointPath('audio')`（`:2541`）
- **取证**（`shots/probe-report.txt` 用例7 / `ai-probe.js`）：
  ```
  URL = "/audio/transcriptions"  → FETCH FAILED: Failed to parse URL from /audio/transcriptions
  ```
- **为什么是缺陷**：浏览器里这个 URL 会被解析成**当前页面域名**下的请求（在 B 站就是 `https://www.bilibili.com/audio/transcriptions`），返回 404/HTML；`:2559` 的 `onerror` 只报「ASR 网络错误」，用户完全看不出是自己没填 API 根地址。
- **建议**：发请求前校验 `base` 非空且以 `http://` / `https://` 开头，否则直接 `state.err = '请先在 ⚙ 设置里填自定义 API 根地址'`。

## A11 · P1 · 自定义音频端点允许填完整 URL → 拼成畸形 URL

- **位置**：`:2504-2510` `aiEndpointPath()`
- **抓包证据**（`shots/mock-stdout.txt:174`）：
  ```
  POST /v1/https://other.host/v1/audio/transcriptions HTTP/1.1
  ```
- **为什么是缺陷**：`:4093` 的 label 写「自定义音频转写端点（留空用 /audio/transcriptions）」，用户很容易粘一个完整 URL 进去，拼完是 `{base}//{另一个完整URL}`。
- **建议**：若 `aiAudioEp` 以 `http` 开头，就整体当 URL 用，不再与 base 拼接；否则才当路径拼。

## A12 · P1 · 硅基流动 `hotwords` 无官方契约依据，且降级正则会误伤

- **位置**：`:2536-2537`（仅 `supportsHotwords` 的 siliconflow 才 append）、`:2548-2556` 降级逻辑
- **契约核对**：SiliconFlow 官方转录接口 body **只声明 `file`、`model`**，没有 `hotwords`（也没有 `language`、`response_format`）。
- **为什么是缺陷**：
  - 若被忽略 → 「ASR 热词注入」这个卖点功能**静默空转**，用户以为在生效；
  - 若被拒 → 走降级。但降级判定正则 `/hotword|热词|parameter|param|unsupported|invalid/i` 含**泛化的 `param` / `invalid`**，模型名填错返回的 "invalid model" / "invalid parameter" 也会命中 → 会**错误地关掉热词开关并重试一次**，把真正的模型名错误掩盖掉（`:2551` 还会写盘 `SETTINGS.hotwordsOn = false`）。
- **建议**：实测一次确认 SiliconFlow 是否接受 `hotwords`；把降级正则收紧到只匹配 `hotword|热词`；关开关前先把原始错误信息 log 出来。
- **待确认**：SiliconFlow 是否真的实现了 `hotwords`。验证方式：拿真实 Key 发一次带 `hotwords=["测试词"]` 的 multipart 请求，看是否 200 且响应体是否体现热词效果。

## A13 · P2 · 「测试连接」用 GET {base}/models 判 Key 有效，跨厂商有偏差

- **位置**：`:4343-4365`
- **现象**：
  - DeepSeek：官方文档写的是 `GET https://api.deepseek.com/models`，代码用 base `https://api.deepseek.com/v1` 拼成 `/v1/models`（有第三方实测报 200，**待确认**两种路径是否都通）。
  - OpenAI：只有 chat 权限的 Key 打 `/v1/models` 可能 403 → 显示「❌ 连接失败：HTTP 403」，但转写其实能用 → 误报。
  - 只判 `2xx` 就「✅ Key 有效」：中间代理/门户返回 200 HTML 也会误报成功。
- **建议**：解析响应体校验 `data` 是数组；OpenAI 403 给"Key 权限不含模型列表，但可能仍可转写"的软提示。

## A14 · P2 · 自定义 base 缺 `/v1` 不校验

- **位置**：`:4091` label 提示「如 https://your-host/v1，不含末尾 /」；`:2500-2501` 只 `.replace(/\/+$/,'')`
- **现象**：填 `https://api.openai.com` 就打 `https://api.openai.com/audio/transcriptions` → 404。
- **建议**：保存时若 base 不以 `/v1` 结尾，弹一次确认 toast（可关闭），而不是只在 label 里写。

## A15 · P2 · 硅基流动不声明 `language` 仍照发；`yue` 对部分后端无效

- **位置**：`:2534` `if (SETTINGS.asrLang && SETTINGS.asrLang !== 'auto') fd.append('language', SETTINGS.asrLang);`
- **现象**：SiliconFlow 官方契约无 `language` 参数（SenseVoice 自动识别）；OpenAI 要求 ISO-639-1，`yue`（粤语，`:4119`）虽在 Whisper 词表内但对 gpt-4o 系不一定接受。
- **建议**：`language` 也按厂商能力标记发送（新增 `supportsLanguage`），SiliconFlow 不发。

## A16 · P2 · 401/402/429 的报错文案不友好

- **位置**：`:2557` `reject(new Error('ASR HTTP ' + r.status + ' ' + responseText.slice(0,160)))`；`:3398` 同款
- **现象**：余额不足（402）、Key 无效（401）、限流（429）都变成一长串英文 JSON 截断体丢在 `state.err`。
- **建议**：按状态码映射中文文案：401 → 「API Key 无效或已过期，请到 ⚙ 设置重新填写」；402 → 「该厂商账户余额不足，请充值或换厂商」；429 → 「触发限流，稍后再试（可降低分片并发）」。

---

# 第二节 · UI 死重 / 无意义显示 / 入口可见性

> 检测方法：`scripts/verify/ui-deadcss.js` 抽出 `<style>` 块（`:3783-3980`）里出现的 80 个 class，与文件其余部分（HTML 字符串 + JS）做引用比对；人工逐条复核排除 `.hit`/`.done`/`.ok`/`.run`/`.bad`/`.on`/`.show` 等动态拼接的误报。

## B1 · P1 · 权重面板整块死 CSS（`scoreWeights` 时代的残留）

- **位置（亮色层）**：`:3879` `.bsr-wbox`、`:3880` `.bsr-wbox.show`、`:3881` `.bsr-wbox textarea`、`:3886` `.bsr-wval`、`:3889` `.bsr-wpresets`、`:3890` `.bsr-wpresets button`、`:3891` `:hover`、`:3892` `button.on`、`:3893` `.bsr-wpreset-tip`、`:3894` `.bsr-wpreset-tip.custom`
- **位置（暗色层）**：`:3946`、`:3947`、`:3950`、`:3951`、`:3952`、`:3953`
- **现象**：全仓库（HTML 字符串 + JS）**没有任何地方生成这些 class**。`:3552` 的注释也写明「评分引擎仍在跑，只是不再给手调滑块」——滑块面板已删，CSS 没跟着删。共 16 行死样式（含暗色层 7 行）。
- **为什么没意义**：用户永远看不到；但每次改主题都要同步维护它们，是纯负债。
- **建议**：删上述 16 行；同时改 `tests/test-ui.js:70-74`（见 B10）。
- **注**：`.bsr-wrow`（`:3883-3884`）和 `.bsr-wtip`（`:3882`）**仍在用**（时间轴面板 `:4036`、`:4041`），保留。

## B2 · P1 · `.bsr-res-r`（评分理由）死 CSS

- **位置**：`:3874` `.bsr-res-r`、`:3875` `.bsr-res-r li`、`:3944` 暗色层
- **现象**：搜索结果卡片渲染（`:4694-4702`）只产出 `.bsr-res-t`（标题）和 `.bsr-res-m`（徽章+meta），**从不产出 `.bsr-res-r`**。
- **为什么没意义**：样式留着但没有渲染路径；同时也意味着"可解释"这个卖点在 UI 上已经失效（见 B4）。
- **建议**：二选一 —— 要么删 CSS（承认放弃可解释性），要么把 `CandidateScorer.scoreCandidate().reasons` 渲染进去（只显示人话短句，不要显示分数和 A/B/C 档位）。

## B3 · P1 · 注释与实现不符：「第一次点展开评分理由」功能已被删

- **位置**：`:4454` 注释 vs `:4455-4460` 实现；`:4681` 注释
- **注释原文**：`// 结果卡片：第一次点展开评分理由，第二次点打开视频（理由是为了「先看为什么再决定」）`
- **实现**：`onclick` 里只有 `openCandidate(search.items[i])` —— 一次点击直接开新标签跳走，没有任何"展开理由"分支。
- **第三处**：`:4681` 注释「否则用户点开「评分理由」时每帧 render 都会重建 DOM」——同一个不存在的功能。
- **为什么没意义**：注释是给后来人看的，撒谎的注释会让人以为功能还在、或以为丢了什么；同时掩盖了"可解释性已消失"这个事实。
- **建议**：删掉这两处注释；若要恢复可解释性，见 B2/B4。

## B4 · P1 · 搜索结果排序依据对用户不可解释

- **位置**：`:3552-3563`（排序：有字幕优先 → `_score` → 播放量）、`:4685`（状态行）
- **现象**：`:3554` 真的在跑 `CandidateScorer.scoreCandidate(it, DEFAULT_WEIGHTS).total`，但 `_score` 只用于排序，**从不展示**；状态行只说「✅ N 个结果 · 有字幕优先 · 点卡片直接打开视频」。用户看到一叠卡片，不知道同档之间为什么是这个顺序。
- **为什么没意义**：README 与代码注释反复强调的「可解释候选评分引擎（A/B/C 三档）」在界面上完全不可见 —— 花了算力、写了模块，用户零感知。
- **建议**：状态行改成「有字幕优先 · 其次按字幕匹配度排序」；或每张卡片补一行人话理由（如「标题命中关键词 · 时长适中」），**不要**显示数字分数和 A/B/C 档位。

## B5 · P2 · 语言下拉里的技术话术

- **位置**：`:4669`
  ```js
  return '<option ...>' + escHtml(s.lan_doc || s.lan) + ' (' + escHtml(s.lan) + ')' + (s.urls.length > 1 ? ' ×' + s.urls.length + '段' : '') + (s.ai ? ' AI' : '') + '</option>';
  ```
- **现象**：下拉项长成「中文（zh-CN） ×3段 AI」。
- **为什么没意义**：`×3段` 是 B 站字幕被切成 3 个接口分片的内部事实，用户不需要知道也无法操作；`AI` 二字没有动词，看不出是"AI 生成的字幕"还是"需要 AI"。
- **建议**：删掉 `×N段`；`s.ai` 改成「（AI 生成）」。

## B6 · P2 · 导出按钮命名歧义

- **位置**：`:4022-4028`
- **现象**：`⬇ TXT`、`⬇ SRT`、`⬇ VTT`、`⬇ MD`、`🤖 AI 文本`、`⏱ 锚点稿` 六个平铺（另加 `📋 复制` 共 7 个，见截图 `shots/browser-01-panel.png`，380px 面板里折成两行）。`⬇ TXT` 与 `🤖 AI 文本` 都是纯文本，区别（带/不带时间戳）只写在 `title` 属性里，鼠标不悬停看不见；`⏱ 锚点稿` 是自造词。
- **为什么没意义**：用户不知道该点哪个，只能全试一遍。
- **建议**：改成「⬇ TXT（带时间）」「🤖 纯文本（无时间）」「⏱ 章节稿（按段分节）」。

## B7 · P2 · 入口深度：`✨ AI 纠错` 无引导

- **位置**：`:4029`（`style="display:none"`）、`:4679`（显示条件 `llmCorrect && aiKey && body && !loading`）、`:4166`（设置项文案）
- **现象**：要看到这个按钮，得：打开折叠的 ⚙ 设置 → 勾「LLM 轻量纠错（付费：纠错按钮只改错字不改句式）」→ 填 Key → 点保存 → 回到字幕面板。设置项文案里也没说按钮会出现在哪。
- **为什么没意义**：功能做完了但用户根本不知道存在。
- **建议**：勾选并保存时 toast「已在字幕面板出现「✨ AI 纠错」按钮」；设置项文案末尾补「（开启后字幕面板会出现该按钮）」。

## B8 · P2 · 内部状态串直接进界面与文件名

- **位置**：`:2605` `state.lan = 'ASR·缓存'`、`:2767` `state.lan = 'ASR·取消'`、`:3486` `state.lan = ... + ' · 已纠错'`；`:4236-4244` 导出文件名用 `'_' + state.lan`
- **现象**：界面顶部和下载下来的文件会出现 `xxx_ASR·缓存.txt`、`xxx_ASR·取消.srt`。
- **为什么没意义**：`ASR` 是开发者术语，`·缓存` / `·取消` 是内部状态机状态，不是给用户看的语言。
- **建议**：`state.lan` 只用「AI 转写」之类的用户语言；缓存/取消这类状态用 toast 说明即可，不要进文件名。

## B9 · P2 · 音频内部实现细节平铺在设置面板

- **位置**：`:4125-4131`「分片时长（长视频转写）」、`:4132-4137`「超长视频策略（3 小时级音频防内存爆）」、`:4138-4144`「播放录制倍速（越高越快·识别率略降）」
- **现象**：三项都是音频解码/内存策略的内部参数，默认值（`auto` / 4 倍速）对 99% 用户就是最优；三项连在一起让设置面板从"AI 配置"变成"工程调参台"。
- **为什么没意义**：普通用户看不懂也不会动，反而拉长了从「API Key」到「保存设置」的滚动距离。
- **建议**：折叠进一个「高级（音频处理）」分区，默认收起；`asrLongMode` 的 `auto` 选项文案保留（它写得不错）。

## B10 · P2 · 测试把死 CSS 钉成契约，阻止清理

- **位置**：`tests/test-ui.js:69-75`
  ```js
  ['.bsr-ta', '.bsr-input', ..., '.bsr-wbox textarea', '.bsr-wpresets button', '#bsr-toast'].forEach(...)
  ```
- **现象**：U4「暗色覆盖完整性」清单里包含两个**已经没有任何 DOM 的死选择器**（`.bsr-wbox textarea`、`.bsr-wpresets button`）。
- **为什么没意义**：测试永远绿（因为只断言"暗色层 CSS 字符串里有这个选择器"），却让人以为这些元素还在；真要删死 CSS 反而要连测试一起改，形成清理阻力。
- **建议**：从清单里移除这两项；B1 的 CSS 删除要同步做。

## B11 · P2 · 「无字幕·需转写」徽章承诺了做不到的事

- **位置**：`:4695-4696` `'<span class="bsr-sub no">无字幕·需转写</span>'`
- **现象**：徽章承诺"可以转写"，但用户若没配 Key（或选了 DeepSeek/OpenRouter），点进去只会得到一句报错。
- **为什么没意义**：文案与实际可执行性不符。
- **建议**：无 Key / 当前厂商 `supportsAudio === false` 时，徽章降级成「无字幕」，并在搜索面板顶部提示「需先在 ⚙ 设置配 Key 才能转写」。

---

# 附：取证方法说明（可复现）

1. **抓包取证**：`scripts/verify/mock-server.js` 起本地 HTTP 服务（`PORT=8787`），`scripts/verify/ai-probe.js` **原样复制**了源码 `:2453-2511` 的 `AI_PROVIDERS` / `aiBaseUrl` / `aiEndpointPath` / `aiAuthHeader` 与 `:2531-2543` 的 FormData 构造、`:3383-3390` 的 chat 构造，把各预设 `base` 指向 mock 后真实发请求。抓到的 request line / headers / multipart body 落在 `shots/mock-stdout.txt`。
2. **死 CSS 检测**：`scripts/verify/ui-deadcss.js` 抽取 `<style>` 块全部 class，与文件其余部分做引用比对，人工复核排除动态拼接误报。
3. **设置项只写不读检测**：`scripts/verify/settings-scan.js` 统计每个 `SETTINGS.*` 键的读取行号（排除 `GM_setValue/GM_getValue` 持久化行）。
4. **厂商契约核对**：SiliconFlow / OpenAI / OpenRouter / DeepSeek 官方文档；OpenRouter 另用免 Key 的 `GET /api/v1/models` 与 `?output_modalities=transcription` 实测（结果落 `shots/openrouter-model-check.txt`、`shots/openrouter-stt-models.txt`）。

# 附：本报告的"待确认"项与验证方式

| 事项 | 为什么没定论 | 怎么验证 |
|------|--------------|----------|
| SiliconFlow 是否接受 `hotwords` / `response_format` | 官方文档只声明 `file`、`model`，未承诺也不否认 | 拿真实 Key 发一次带 `hotwords=["测试词"]` 与 `response_format=srt` 的 multipart 请求，看状态码与响应体形态 |
| `deepseek-chat` / `deepseek-reasoner` 是否仍可用 | 官方 Models & Pricing 未列出，但可能是遗留别名 | `POST https://api.deepseek.com/v1/chat/completions`，body model=`deepseek-chat`，看是否 200 |
| DeepSeek `/v1/models` 是否可用 | 官方文档写 `GET /models`，代码拼 `/v1/models` | 拿真实 Key 分别打两个路径看状态码 |
| `openai/whisper-large-v3` / `openai/whisper-1` 在 OpenRouter 是否在售 | 未出现在 `output_modalities=transcription` 前 15 条（共 26 条已落盘） | 查 `shots/openrouter-stt-models.txt` 完整清单，或用真实 Key 试转一次 |
| 硅基流动 chat 模型名（`Qwen/Qwen2.5-72B-Instruct` 等）是否仍在架 | 模型清单需 Key 才能拉 | 拿 Key 打 `GET https://api.siliconflow.cn/v1/models` 核对；或打开"测试连接"按钮看是否 200 |
