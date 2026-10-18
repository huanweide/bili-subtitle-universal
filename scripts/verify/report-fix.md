# 修复报告：系统性「吞失败 / 谎报成功 / 误导白烧 ASR 额度」

改动文件：
- `bili-subtitle.user.js`（唯一源码文件，未 bump `@version`、未碰 README/CHANGELOG、未 commit/push）
- `tests/test-claims.js`（2 条断言更新为新的正确行为）
- `tests/test-ui.js`（1 条断言里已删掉的死 CSS 换成在用的选择器）
- `scripts/verify/verify-fix.js`（新增：本次修复的行为验证脚本，39 条）

自查结果：`node --check bili-subtitle.user.js` 通过；10 个测试文件全绿
（run-tests 86/86、test-claims 89/89、test-scorer、test-wiring 79/79、test-ui 21/21、
test-site、test-sub、test-route、test-roundtrip、check-docs 全部一致）。

> 注：改动前的行号取自任务单里的复核结论，改动后的行号是本次落地后的实际行号。

---

## P0-A｜AI 转写响应不再伪造时间戳（最严重）

**改了什么**（`bili-subtitle.user.js:2632-2668`，新增 `extractAsrText` / `asrToSegments`；`asrEstTs` 声明在 `2679`）

旧代码：5 个调用点全是 `parseSrt(raw)` → 解析不出就 `splitTextByTime(raw, ...)`。
硅基流动/OpenRouter/OpenAI 默认返回的 `{"text":"..."}` 被当成 SRT 解析 → 0 句 →
落到 `splitTextByTime` 在 0~时长里均匀铺时间戳。界面显示「✅ N 句 · ASR」，
**每个时间都是编的**。

新代码：
1. 先 `parseSrt`（有真时间戳就用真的）；
2. 否则 `extractAsrText` 剥 JSON，按 `text → result → transcript → transcription → data.text → choices[0].message.content` 取值；接口 `error` 体直接把官方原因抛出来；
3. 拿到文字才允许按长度估算时间轴，并置 `asrEstTs = true`；
4. `extractAsrText` 返回 `null`（认不出这个响应）→ **明确报错**，一条段都不生成。

调用点全部改走 `asrToSegments`（5 处）：
`2753`（整段直传）、`2845`（分片）、`2906`（splitProcess 递归）、`3132`（segmentAsr 批）、`3382`（播放录制）。

顺带修掉的两个同源缺陷：
- **偏移被加了两次**：旧代码 `splitTextByTime(text, i2*chunkDur, ...)` 之后又 `s.from += i2*chunkDur`，
  第 2 片及以后的时间戳整体翻倍后移。现在统一传 0 基窗口（`2845`、`2906`、`3132`、`3382`）。
- **`rec.wav` 对半拆的两份响应直接字符串相加**（`3371`）：两份 JSON 连起来是非法 JSON。
  现在各自 `extractAsrText` 再拼。

**怎么验证它生效**：`scripts/verify/verify-fix.js` 直接从主脚本抠函数跑（`PASS 39/39`）：
```
[PASS] 硅基流动式 JSON 响应能剥出文字（不再是 0 句）
[PASS] 剥出的文字是接口原文，不是 JSON 字符串本身
[PASS] JSON 响应（无时间戳）被如实标记为估算时间轴
[PASS] 真 SRT 响应走解析路（1 句，时间戳 1.0~2.5）
[PASS] 空响应 "" → 报错
[PASS] 纯噪声 JSON（没有文本字段）→ 报错
[PASS] 非法 JSON → 报错
[PASS] 接口 error 体 → 报出接口给的原因
[PASS] 报错路径一条都没生成字幕段（不是先吐段再报错）
[PASS] {"text":""}（静音段）→ 0 段且不报错，不铺空白句
```
最后一条是刻意的区分：**「这段是纯音乐」也是正经结果**（跳过，不许拿空串铺出一句空白字幕），
只有**认不出的响应**才报错——否则 3 小时视频里一段静音就会把整轮转写打断。

用户侧如实提示：`merged.estTs = asrEstTs`（`2881`）→ 状态行显示
「⚠️ 时间轴为估算（接口未返回时间戳）」（`4665`），完成 toast 也带一句（`2891`）。

---

## P0-B｜`response_format` 条件化

**改了什么**：`bili-subtitle.user.js:2597`

```
旧：fd.append('response_format', 'srt');            // 无条件
新：if (SETTINGS.aiProvider === 'openai' && /^whisper/i.test(SETTINGS.asrModel || ''))
      fd.append('response_format', 'srt');
```
依据：OpenRouter 官方文档写明 `text`/`srt`/`vtt` 一律 400（只收 `json`/`verbose_json`）；
OpenAI 的 `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 只认 `json`/`text`；
硅基流动契约里没有这个参数。宁可不发。

**验证**：`verify-fix.js` 的 `[PASS] response_format 只在 OpenAI whisper 系列下才发`（源码正则断言）；
并手工核对了 OpenRouter STT 文档（搜到原文：`text, srt, and vtt are rejected with a 400`）。

---

## P0-C｜模型预设删掉官方不存在的 SenseVoiceLarge

**改了什么**：`bili-subtitle.user.js:2499`

```
旧：asrModels: ['FunAudioLLM/SenseVoiceSmall', 'FunAudioLLM/SenseVoiceLarge']
新：asrModels: ['FunAudioLLM/SenseVoiceSmall']
```

**验证**：`[PASS] 硅基流动不再给出官方不存在的 SenseVoiceLarge`（读 `AI_PROVIDERS` 实际值断言，
不是正则）；`grep -c SenseVoiceLarge` = 0。

---

## P0-D｜切换 AI 厂商必须重置模型名

**改了什么**：`bili-subtitle.user.js:4542-4558`（新增 `applyProviderDefaults`，挂在
`#bsrAiProvider.onchange` 上，`4558` 处调用）

`refreshProviderUI` 只刷 datalist、从不改 input 的 value，切到 OpenAI 后 multipart 里带的
还是 `FunAudioLLM/SenseVoiceSmall`。现在切厂商会把 `#bsrAsrModel` / `#bsrTModel` 的值
设成新厂商清单里的第一个并立即 `saveSettings()`（换完不点「保存」也不会带着上家的模型名发请求）。
自定义厂商清单为空 → 不动，保留用户手填。

**验证**：`[PASS] 换厂商时重置模型输入框的值（applyProviderDefaults）`（源码断言）。
**未完成**：没有真机抓包复验（需要浏览器 + 真实 Key），本条只做了代码与静态验证，
请在浏览器里切一次厂商确认输入框被改写。

---

## P0-E｜YouTube 受限视频必须说人话

**改了什么**：
1. `bili-subtitle.user.js:2079-2085`（YouTube `resolve`）——读 `playabilityStatus.status` / `reason`，
   非 OK 时写入 `state.ytBlocked = 'YouTube 拒绝播放：' + (reason || status)`。
2. `bili-subtitle.user.js:3741-3743`（`getSubtitles`）——resolve 之后、`asrForce` 分支**之前**
   就拦截：`state.err = state.ytBlocked` 并 return，不再落到「本视频无字幕」。
3. `bili-subtitle.user.js:4660-4662`（状态行）——YouTube 无字幕的文案按站点区分：
   说明「YouTube 音频是带签名的分片流，取不到音频、无法 AI 转写——请换用带字幕（含官方自动字幕）的视频」，
   不再喊「点击下方 AI 转写」。

**验证**：`verify-fix.js`
```
[PASS] YouTube resolve 读取 playabilityStatus.status / reason
[PASS] ytBlocked 卡在 AI 转写引导之前
[PASS] YouTube 无字幕文案已按站点区分（不再喊「点 AI 转写」）
```
**未完成**：没有真机受限视频（登录墙/年龄限制）实测——团队里已有 `run-youtube-verify.js`
与 `report-youtube.md`，本条建议由那边的浏览器验证补一条真实 `LOGIN_REQUIRED` 用例。

---

## P0-F｜4xx 不再被 ASR 回退吞掉

**改了什么**：`bili-subtitle.user.js:3786-3795`

旧：`state.err=''` 然后 `runAsr()` —— 真实错误（HTTP 403 等）被替换成误导性的
「未配置 AI API Key」。

新：
```
var msg = String((e && e.message) || e || '');
var hardFail = /HTTP\s+4\d\d/.test(msg) || state.ytBlocked;
var canAsr  = state.adapter && state.adapter.id !== 'youtube';
if (SETTINGS.asrFallback && !state.asrRan && !state.body && !hardFail && canAsr) { ... }
state.err = '提取失败：' + msg + (hardFail ? '（接口明确拒绝，未回退 AI 转写）' : '');
```
`gx()` 的网络错误就是 `new Error('HTTP ' + r.status)`，所以 401/403/404 都会命中 `hardFail`；
5xx、超时、空结果这类软失败仍然兜底转写。YouTube 因 `getAudio()` 恒为 null 直接跳过回退。

**验证**：`[PASS] 4xx 不再被 ASR 回退吞掉`、`[PASS] YouTube 直接跳过 ASR 回退（它没有音频可转）`。

---

## P0-G｜B 站「需登录」不伪装成「无字幕」

**改了什么**：
- `bili-subtitle.user.js:2016-2019`（B站 `fetchSubs`）——读 `subRoot.need_login_subtitle` → `state.subNeedLogin`。
- `bili-subtitle.user.js:3759-3762`（`getSubtitles`）——无轨道且该标志为真时：
  `state.err = '该视频字幕需登录后可见，请先登录 B 站再重试（不是无字幕，不用 AI 转写）'`，直接 return。
- `state` 新增字段 `subNeedLogin`（`1488`），每轮开头复位（`3728`）。

**验证**：`[PASS] B 站 need_login_subtitle 已读取并给出「需登录」提示`。
**未完成**：B 站未登录账号下的真实接口返回未抓到（没有可用的未登录环境），
字段位置按 B 站 `player/wbi/v2` 的 `data.subtitle.need_login_subtitle` 约定实现；
若实测字段名不同，只需改 `2019` 一行。

---

## P1-1｜WBI 签名真正生效

**改了什么**：`bili-subtitle.user.js:1787-1792`

```
旧：if (d.code !== 0 || !d.data || !d.data.wbi_img || !d.data.wbi_img.img_url) throw ...
新：if (!d || !d.data || !d.data.wbi_img || !d.data.wbi_img.img_url || !d.data.wbi_img.sub_url) throw ...
```
未登录时 `nav` 返回 `code=-101` 但 `wbi_img`/`wbi_sub` 照样完整下发，旧判断直接 throw，
WBI 签名等于从没生效过。现在以密钥本身在不在为准（顺带把 `sub_url` 一起校验，
缺了会在下面 `.split` 处 TypeError，不如提前给一句人话）。

**验证**：`[PASS] WBI 以 wbi_img/wbi_sub 是否存在为准，不再硬性要求 code===0`；
run-tests 的 md5/wbiSign/wbiQuery 用例仍全绿（86/86）。
**未完成**：没跑真实未登录 `nav` 请求（需浏览器 + B 站环境）。

---

## P1-2｜陈旧 playerResponse 的标题串台

**改了什么**：`bili-subtitle.user.js:2067-2075`

`stale` 为真时除了清 tracks，现在把 `state.title / state.up / state.duration` 一并清掉
（随后走 `document.title` 兜底取标题）。以前导出文件名会顶着上一条视频的名字。

**验证**：代码走查 + `[PASS] YouTube resolve 读取 playabilityStatus...`（同一段改动）。
**未完成**：没有 SPA 连切两个视频的真机复现验证。

---

## P1-3｜OpenRouter 能力标记

**改了什么**：`bili-subtitle.user.js:2523-2530`

```
旧：audio: null, supportsAudio: false
新：audio: '/audio/transcriptions', supportsAudio: true
    asrModels: ['openai/whisper-1', 'openai/gpt-4o-mini-transcribe', 'openai/gpt-4o-transcribe']
```
界面文案同步：`4535`「该厂商不支持语音转写，仅翻译可用」→「该厂商不提供语音转写端点，仅翻译可用」；
`aiTranscribe` 与 `runAsr` 的提示语也补上了 OpenRouter（`2583`、`2693`）。

**验证**：`verify-fix.js` 三条（端点/清单/标记）；`tests/test-claims.js` 的
「OpenRouter 端点正确」与新增的「OpenRouter 标记为支持语音转写」两条断言。
依据：OpenRouter 官方文档——`POST /api/v1/audio/transcriptions`，支持 multipart（≤25MB），
STT 模型走 `?output_modalities=transcription` 发现。

---

## P1-4｜单文件上限 40MB → 25MB

**改了什么**：`bili-subtitle.user.js:2416`（`MAX_SINGLE = 25 * 1024 * 1024`），
注释同步（`2743`「≤40MB」→「≤25MB」）。OpenAI / OpenRouter 硬上限都是 25MB，
25~40MB 的文件以前会老老实实传完再吃一个 413。

**验证**：`[PASS] 单次直传上限改成 25MB（对齐 OpenAI/OpenRouter 官方限制）`（同时断言 40MB 已不存在）。

---

## P1-5｜翻译不能静默丢行

**改了什么**：`bili-subtitle.user.js:3483`（`aiTruncated`）、`3491`（带 `max_tokens: 8192`）、
`3499`（`finish_reason === 'length'` 置位）、`3537-3550`（按批对账 + 收尾提示）

每批译回的条数少于送进去的条数当场 toast：「第 N 批只译回 X/Y 条（被模型长度上限截断，
可减少一次处理的条数或换上下文更长的模型）」；整轮结束再提示一次。

**验证**：`[PASS] aiChat 带 max_tokens 并检查 finish_reason=length`。
**未完成**：没有真实 Key 触发一次 `finish_reason=length` 的实测。

---

## P1-6｜自定义厂商 URL 拼接

**改了什么**：新增 `aiUrl(kind)`（`bili-subtitle.user.js:2555-2568`），
`aiTranscribe`（`2600`）与 `aiChat`（`3487`）都改用它。

- 根地址留空 → `throw new Error('自定义厂商还没填 API 根地址（⚙ 设置 → 「自定义 API 根地址」，例如 https://your-host/v1）')`，
  不再拼出打到当前页面域名的相对路径；
- 端点填了完整 URL → 直接返回，不再拼成 `base + '/' + 'https://...'`；
- 「测试连接」按钮（`4461` 附近）本来就有空 base 的 toast 保护，未动（test-claims 仍在断言 `base + '/models'`）。

**验证**（真实跑函数，非正则）：
```
[PASS] 根地址留空 → 明确报错（不再拼出打到当前页面域名的相对路径）
[PASS] 填了根地址 → 正常拼
[PASS] 音频端点填完整 URL → 直接用它，不再拼成 https://my-host/v1/https://other-host/asr
[PASS] 内置厂商仍走预设端点
```

---

## P1-7｜热词降级误判

**改了什么**：`bili-subtitle.user.js:2611`

```
旧：/hotword|热词|parameter|param|unsupported|invalid/i
新：/hotword|热词|unsupported/i
```
模型名写错时接口也回 "invalid parameter"，旧正则会把它误判成「账号不支持热词」，
悄悄关掉用户好好开着的热词开关，真正的错误反而被吞。

**验证**：`[PASS] 热词降级正则不再含泛化的 param|invalid`；test-wiring 的
「热词不支持时自动降级」仍 PASS（它断言的是 `hotwordsFallbackDone` 与日志文案）。

---

## P1-8｜TTML 注释当字幕

**改了什么**：`bili-subtitle.user.js:1888-1897`（`parseTtml`）

匹配前先 `.replace(/<!--[\s\S]*?-->/g, '')` 剥掉 XML 注释；再把匹配范围限制在 `<body>` 内
（`<head>` 里的 `<p>` 是样式/元信息）。没有 `<body>` 时退回全文，不至于整篇解析不出来。

**验证**：`verify-fix.js` 喂了一段同时含「head 里的 p」「注释里的 p」「body 里的真字幕」的 TTML：
```
[PASS] 只解析出 1 句（head 的 p 与注释里的 p 都被排除）
[PASS] 内容是真字幕
```

---

## P2-1｜无字幕时不要显示导出按钮

**改了什么**：`bili-subtitle.user.js:4808-4816`

原来是 `$('#bsrOps').style.display = 'flex'` 无条件显示整排。
但 `#bsrOps` 里除了导出按钮，还装着 `bsrAsrBtn`（AI 转写）、`bsrCancel`（取消）、
`bsrUnlock`（解锁播放）——**无字幕、转写中时恰恰要用它们**，整排藏掉会让用户彻底没路可走。
所以改成只藏 7 个导出按钮（`#bsrCopy/#bsrTxt/#bsrSrt/#bsrAiTxt/#bsrAnchor/#bsrVtt/#bsrMd`），
动作按钮照旧由各自的条件控制。

**验证**：`[PASS] 导出按钮只在有字幕时显示（AI 转写/取消/解锁不受影响）`。

---

## P2-2｜删除死 CSS

**改了什么**（`bili-subtitle.user.js` CSS 段）：删掉
`.bsr-res-r` / `.bsr-res-r li`、`.bsr-wbox`（含 `.show` 与其 `textarea`）、
`.bsr-wval`、`.bsr-wpresets`（含 `button` / `button:hover` / `button.on`）、
`.bsr-wpreset-tip`（含 `.custom`），以及暗色层里对应的 6 条覆盖规则。

删除前逐个数过 HTML 里的引用（`class="..."` 计数全部为 0），确认是死代码；
仍在用的 `.bsr-wrow` / `.bsr-wtip` / `.bsr-pbox` / `.bsr-prompts` 一行没动。

**验证**：`[PASS] 死 CSS 已清（...全无引用）`（断言源码里这些串已完全消失）。
`tests/test-ui.js` 的 U4 原本在断言 `.bsr-wbox textarea` / `.bsr-wpresets button`
必须在暗色层里有覆盖——这是**断言了旧的错误行为**，已改成仍在用的
`.bsr-findinfo` / `.bsr-pbox input[type=number]`。

---

## P2-3｜修掉撒谎注释

**改了什么**：
- `bili-subtitle.user.js:4584`（旧：`结果卡片：第一次点展开评分理由，第二次点打开视频`）
  → `点一下直接用本脚本打开该视频（v9.16 起不再有「先展开评分理由」这一层）`
- `bili-subtitle.user.js:4824`（旧：`否则用户点开「评分理由」时每帧 render 都会重建 DOM，展开状态当场丢失`）
  → `否则每帧 render 都会重建 DOM，刚渲染好的卡片被白刷一遍`

**验证**：`[PASS] 撒谎注释已改（不再声称「第一次点展开评分理由」）`。

---

## P2-4｜OpenRouter 下线模型换成在售等价档

**改了什么**：`bili-subtitle.user.js:2529`

```
旧：['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct']
新：['openai/gpt-4o-mini', 'anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash', 'meta-llama/llama-3.1-8b-instruct']
```
`deepseek-chat` / `deepseek-reasoner`（`2511`）**按交代保留不动**。

**验证**：`[PASS] OpenRouter 已下线的 claude-3.5-haiku / gemini-flash-1.5 已换掉`、
`[PASS] DeepSeek 的 deepseek-chat / deepseek-reasoner 保留不动（官方长期别名，别臆断删）`。

---

## 没做到 / 需要别人补的

| 项 | 状态 | 原因 |
|---|---|---|
| P0-D 真机抓包复验 | 未完成 | 需浏览器 + 真实 Key，本次只有静态与代码验证 |
| P0-E 真实受限 YouTube 视频 | 未完成 | 手里没有 LOGIN_REQUIRED 的实测页面；逻辑已按 `playabilityStatus` 实现，建议并进 `run-youtube-verify.js` |
| P0-G 真实 `need_login_subtitle` 返回 | 未完成 | 没有未登录 B 站环境；字段位置是照接口约定实现的，实测若不同只改 `2019` 一行 |
| P1-1 未登录 `nav` 实测 | 未完成 | 同上，需要浏览器环境 |
| P1-5 触发一次真实 `finish_reason=length` | 未完成 | 需要真实 Key 与超长批次 |

## 怎么复跑

```bash
NODE="C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
NODE_PATH=C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules

$NODE --check bili-subtitle.user.js
for f in run-tests test-claims test-scorer test-wiring test-ui test-site test-sub test-route test-roundtrip check-docs; do
  NODE_PATH=... $NODE tests/$f.js
done
$NODE scripts/verify/verify-fix.js     # 本次修复的专项验证，PASS 39/39
```
