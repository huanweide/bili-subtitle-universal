# YouTube 与通用站点兼容性验证报告

> 验证对象：`bili-subtitle.user.js`（4838 行，单文件 IIFE）
> 验证方式：Playwright 真实 Chromium + `page.route` 注入高仿 fixture（**不是**访问真网）
> 验证日期：2026-10-19
> 复现脚本：`scripts/verify/run-youtube-verify.js`　原始结果：`scripts/verify/verify-results.json`

---

## 0. 一句话结论

YouTube 主链路**能跑通**：6 种 URL 形态全部被认领，`ytInitialPlayerResponse → captionTracks → timedtext(fmt=ttml) → parseTtml → mergeBodies → #bsrOut` 这条链在真实浏览器里产出了 **content 非空** 的字幕行，时间轴与源 TTML 逐条对齐。通用站点的 `<track>` 与 `textTracks` 两条路也都通。

但有 **4 个真实缺陷**（3 个会直接影响用户判断，1 个是解析健壮性）+ **2 项无法验证**（真网 YouTube、真·付费视频）。其中最该修的是：**受限视频被谎报成「本视频无字幕，点 AI 转写」**，而 YouTube 这条路根本转写不了。

| 计数 | 项目 |
| --- | --- |
| 通过 | 15 项 |
| 失败 | 4 项（F1–F4） |
| 未验证 | 2 项（N1–N2） |
| 用例总数 | 16 个（1-1 … 16，见 `verify-results.json`） |

---

## 1. 环境与可信度边界（先说清楚，免得把结论看大了）

### 1.1 真网 YouTube 不可达（实测）

```
$ curl -o /dev/null -w "%{http_code}" --max-time 8 https://www.youtube.com/
000
$ curl -o /dev/null -w "%{http_code}" --max-time 8 "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
000
```

`000` = 连不上（8 秒超时）。因此**本报告没有任何一条结论来自真实 YouTube**。

### 1.2 那用什么替代

用 `page.route('**/*')` 拦截所有发往 `youtube.com / youtube-nocookie.com / youtu.be` 的请求，用 `scripts/verify/fixtures/` 下的高仿响应就地替换：

- 页面请求 → 返回 `yt-*.html`（内含真实形态的 `var ytInitialPlayerResponse = {...}`）
- `/api/timedtext?...&fmt=ttml` → 返回 `yt-timedtext-*.ttml`
- 其余外部资源（i.ytimg / googlevideo / googleapis）→ 204 空响应，**保证不出网**

这样做的价值：跑的是**真实的 `bili-subtitle.user.js` 源码**、真实的 Chromium 解析、真实的 DOM 渲染，只有「网络另一端返回什么」被替换。所以能验证脚本逻辑，**不能**验证「YouTube 今天是否还这么返回」。

### 1.3 GM API 打桩

Chromium 没有 Tampermonkey 的 `GM_*`，脚本会直接 `ReferenceError`。`run-youtube-verify.js` 里用 `addInitScript` 补了 4 个（脚本只用到这 4 个，已 `grep` 确认）：

| API | 打桩方式 |
| --- | --- |
| `GM_getValue` / `GM_setValue` | 内存 map + localStorage（首次读可用 `__BSR_PREFILL__` 预置） |
| `GM_notification` | 记录到 `window.__BSR_NOTIFY__` |
| `GM_download` | 记录到 `window.__BSR_DOWNLOADS__`（脚本实际导出走 `<a download>` + Blob，另拦截 `URL.createObjectURL` 读回文本） |
| `GM_xmlhttpRequest` | **页面内 XHR** 实现，支持 GET/POST、`text`/`arraybuffer`/`blob`、onload/onerror/ontimeout。走 XHR 是刻意的——这样请求仍经过 Chromium 网络栈，能被 `page.route` 拦到 |

### 1.4 两个 fixture 层面的人为因素（别误读成脚本 bug）

1. **`⚠️ 字幕可能不完整`**：`yt-watch.html` 里 `lengthSeconds=212`，而字幕只到 22 秒。`checkIntegrity()`（1641-1646 行，`lastTo < duration*0.6`）据此判「不完整」。这是 fixture 时长与字幕长度不匹配造成的，**不是脚本判断错**。
2. **case 06a 用客户端跳转代替 303**：真实 `youtu.be/<id>` 是服务端 303 跳 watch。但 Playwright `route.fulfill({status:303})` 时 Chromium **不会跟随**（实测：请求停在 youtu.be，第二个请求根本没发出），故改用等价的 `location.replace()` 跨源跳转。最终文档状态与真实 303 一致。

### 1.5 关于 URL 认领规则的「内联副本」是否过期

主脚本是 build 产物，`modules/site-match.js` 被内联进去了。逐字比对（忽略缩进）：

```
规则段（var RULES = [...]）规范化后逐字相同: true
主脚本含 function createSiteMatchModule(): true
```

即：读 `modules/site-match.js` 等价于读主脚本里正在跑的那份规则，不存在「测试测的是旧副本」。

---

## 2. 逐项验证结果

> `xhr` 列指实际发出的 timedtext 请求数；`行数` 指 `#bsrOut .bsr-line` 的条数。
> 「字幕增强」= `SETTINGS.polishOn`（默认 **开**），会把相邻短句合并，所以默认设置下 6 条 TTML 会显示成 3 行——这是设计行为，为拿到「解析层原始条数」另有 case 13/14（关掉增强）。

| # | 验证项 | 方法（fixture / 真网） | 结果 | 证据（DOM 抓取值 / 截图） |
| --- | --- | --- | --- | --- |
| 1-1 | `watch?v=` 认领 + 抽 videoId + 取字幕 | fixture `yt-watch.html` | **PASS** | `#bsr-fab` 出现；`#bsrTitle` = `Rick Astley - Never Gonna Give You Up (Official Music Video)`；timedtext 请求含 `v=dQw4w9WgXcQ&fmt=ttml`；3 行，首行 `大家好，欢迎回到我的频道，今天我们来聊聊 YouTube 字幕的抓取。`；`yt-01-watch.png` |
| 1-2 | `/embed/` 认领 | fixture `yt-embed.html` | **PASS** | 同上标题；3 行；`yt-02-embed.png` |
| 1-3 | `/shorts/` 认领 | fixture `yt-shorts.html` | **PASS** | `#bsrTitle` = `Rick Astley - Never Gonna Give You Up #shorts`；3 行；`yt-03-shorts.png` |
| 1-4 | `/live/` 认领 | fixture `yt-live.html` | **PASS** | `#bsrTitle` = `直播中 · 测试频道`；3 行；无「不完整」告警（时长 0）；`yt-04-live.png` |
| 1-5 | `youtube-nocookie.com/embed/` 认领 | fixture `yt-nocookie-embed.html` | **PASS** | 3 行；字幕请求打到 `https://www.youtube-nocookie.com/api/timedtext?...`（host 随 baseUrl 走，未被硬编码成 youtube.com）；`yt-05-nocookie.png` |
| 1-6 | `youtu.be/<id>` 短链（跳到 watch 后） | fixture `yt-youtu-be-redirect.html` → `yt-watch.html` | **PASS** | 最终 URL `https://www.youtube.com/watch?v=dQw4w9WgXcQ`；3 行；`yt-06a-youtube-be-redirect.png` |
| 1-6b | `youtu.be/<id>` 短链（停在短链页） | fixture `yt-youtu-be.html` | **PASS（预期内）** | `#bsr-fab` 出现（认领成立）；`#bsrTitle` = `dQw4w9WgXcQ`（取自 `document.title`）；`ℹ️ 本视频无字幕…`；`yt-06b-youtube-be-hold.png`。说明：真实 youtu.be 页面上没有 playerResponse，这一态必然取不到字幕，属于重定向前的中间态，不算缺陷 |
| 2-1 | 字幕抓取链路产出 `{from,to,content}` 且 **content 非空** | case 13（关「字幕增强」）+ 导出 SRT | **PASS** | 6 条 TTML → 6 行，SRT 逐条对齐：`1 / 00:00:01,500 --> 00:00:04,200 / 大家好，欢迎回到我的频道` … `6 / 00:00:18,300 --> 00:00:21,900 / 最后一句，验证合并与排序`。**每条 content 都非空**，历史上「换成别的 key 导致预览全空」的 bug 不存在——渲染取的就是 `item.content`（4507-4513 行） |
| 2-2 | 多语言轨道列表 + AI 标记 | case 01 的下拉框 | **PASS** | `#bsrLan` 选项：`zh-Hans=Chinese (Simplified) (zh-Hans)`、`ja=Japanese (ja)`、`en=English (auto-generated) (en) AI` —— `kind:'asr'` 的轨道被正确打上 `AI` |
| 2-3 | 切换语言重取 | case 01 `selectOption('en')` | **PASS** | `✅ 3 句 · en · 89 字`，首行 `this is the auto generated english track。`；`yt-01-watch-after-switch.png` |
| 2-4 | 陈旧 playerResponse 守卫 | case 07（地址栏 `bbbbbbbbbbb`，PR 内 `dQw4w9WgXcQ`） | **PASS（字幕侧）/ 见 F4（标题侧）** | 字幕轨道被丢弃 → `ℹ️ 本视频无字幕`，不会拿上一条视频的字幕张冠李戴；但 `#bsrTitle` 仍是旧视频标题（F4）；`yt-07-stale.png` |
| 3-1 | 受限视频（`playabilityStatus.reason`，关 ASR） | fixture `yt-watch-restricted.html`（`status=LOGIN_REQUIRED, reason="Sign in to confirm you're not a bot."`，无 `captions` 键） | **FAIL（F2）** | 界面显示 `ℹ️ 本视频无字幕，点击下方「AI 转写」可语音生成字幕`——`reason` 一个字都没露；`yt-08-restricted-reason.png` |
| 3-1b | 受限视频（**默认设置**，`asrEnable/asrFallback` 开） | 同上，`ASR_DEFAULT` | **FAIL（F2 + F3 叠加）** | 界面变成 `⚠️ 未配置 AI API Key（⚙ 设置 → 选厂商并填入 Key；…）`；`#bsrTitle` = `受限视频`（标题是对的，说明 playerResponse 读到了，只是没人读 `reason`）；`yt-16-restricted-default.png` |
| 3-2 | 字幕接口 403（关 ASR 回退） | fixture `yt-watch.html` + 路由返回 403 | **PASS（报错明确）** | `⚠️ 提取失败：HTTP 403`；timedtext 请求发出 **2 次**（`retries:1` → 1 次重试）；控制台 `Error: HTTP 403 at Object.onload (<anonymous>:1673:25)`；`yt-09-captions-403.png` |
| 3-3 | 字幕接口 403（**默认设置**，`asrFallback` 开） | 同上，`bsr_asr_enable/fallback=true` | **FAIL（F3）** | 界面变成 `⚠️ 未配置 AI API Key（⚙ 设置 → 选厂商并填入 Key；…）`——**真实的 HTTP 403 被吞掉**，用户以为是没配 Key；`yt-10-captions-403-default.png` |
| 4-1 | 通用站点 `<video>` + `<track kind=captions src=*.vtt>` | 本地 HTTP 服务 `generic-track.html` + `generic-sub.vtt`（`text/vtt`） | **PASS** | 4 条 cue → 关增强 4 行、默认增强 1 行；`<i>` 内联标签被剥掉（`第三句 带内联标签 应被剥掉`）；SRT 时间 `00:00:01,000 --> 00:00:04,000`；`yt-11-generic-vtt.png` / `yt-14-generic-vtt-nopolish.png` |
| 4-2 | 通用站点 JS 挂的 `video.textTracks`（DOM 无 `<track>`） | `generic-texttracks.html`（`addTextTrack('captions')` + 3 个 `VTTCue`） | **PASS** | 3 个 cue → 1 行（默认增强合并）；`内存轨道第三句 带标签` 标签被剥；`yt-12-generic-texttracks.png` |
| 2-5 | `parseTtml` 对非正文内容（XML 注释）的健壮性 | `yt-timedtext-comment.ttml`（正文 2 条 + 注释里 1 个示例） | **FAIL（F1）** | 解析出 **3 条**，第 1 条正文是 `，注释里额外放了一个  示例，用来看解析器会不会把它也算进去。\n\n示例：这是注释里的示例文本`；`yt-15-ttml-comment.png` |
| 5 | 预览渲染全站通用（`.bsr-line .bsr-tx` 有文字） | 以上所有出字幕的 case 统一取 DOM | **PASS** | 16 个 case 中所有 `count > 0` 的用例，`document.querySelectorAll('#bsrOut .bsr-line .bsr-tx')` 取到的文本首条均非空（逐条记录见 `verify-results.json` 的 `lines` 字段）；同时 `.bsr-ts` 有 `0:01 / 0:04 / 0:07 / 0:18` 等时间戳，行结构完整 |

---

## 3. 失败项详情（现象 / 根因 / 建议）

### F1　`parseTtml` 把 XML 注释当成字幕（解析健壮性）

**现象**：`yt-timedtext-comment.ttml` 正文只有 2 条 `<p>`，注释里写了 1 个「条目长什么样」的示例（`<p begin="…">这是注释里的示例文本</p>`）。实测解析出 **3 条**：

```
第 1 条 = "，注释里额外放了一个  示例，用来看解析器会不会把它也算进去。\n\n示例：这是注释里的示例文本"   ← 注释被吞了
第 2 条 = "注释用例第一条"
第 3 条 = "注释用例第二条"
```

同一个坑在本报告的主用例里也踩到过：`yt-timedtext-zh-Hans.ttml` 的注释里原本写了条目示例，结果 6 条字幕被解析成 7 条，第 1 条是 `文本`（`00:00:00,000 --> 00:00:00,000`）。现在主用例的 fixture 已把示例挪走，条数恢复成干净的 6 条。

**根因**：`parseTtml()`（**1876-1900 行**）用一条全局正则在**整份文档**上扫 `<(text|p) …>…</(text|p)>`（`tagRe` 在 **1878 行**），既不先删 `<!-- -->`，也不限定在 `<body>` 内。注释里的 `<p>` 与正文的 `</p>` 跨段配对，于是把注释 + `<head>` 一起当成一条字幕。

**影响**：真实 YouTube timedtext 返回没有注释，所以**不会**在 YouTube 上触发；但 TTML/DFXP 是通用格式，别的站点（或 YouTube 未来加个注释）就会串进垃圾字幕，而且是「多出一条莫名字幕」这种不显眼的错。

**建议**：`parseTtml` 开头先做两道清洗再匹配：

```js
var xml = String(xmlText)
  .replace(/<!--[\s\S]*?-->/g, '')          // 注释整块删掉
  .replace(/<head[\s\S]*?<\/head>/gi, '');  // head 里只有样式/元数据
```

（只提改法，未改代码。）

---

### F2　受限视频被谎报成「本视频无字幕，点 AI 转写」（最该修的一条）

**现象**：case 08 的 playerResponse 是

```json
"playabilityStatus": { "status": "LOGIN_REQUIRED", "reason": "Sign in to confirm you're not a bot." }
```

且没有 `captions` 键。用户点「获取字幕」后看到的是：

```
ℹ️ 本视频无字幕，点击下方「AI 转写」可语音生成字幕
```

`reason` **一个字都没显示**。这句话有两个问题：

1. 视频不是「没有字幕」，是「你根本没被允许播」——登录/会员/地区/风控，用户该做的是去登录，而不是找字幕。
2. 「点 AI 转写」在 YouTube 上是**死路**：`adapters.youtube.getAudio` 恒返回 `null`（**2082 行**），脚本自己也知道（2615 行有提示「YouTube 音频需解流媒体签名，暂不支持 AI 转写」）。等于把用户指向一个必然失败的按钮。

**两种设置下的实际表现（都验过）**：

| 设置 | 用户看到的 | 距真相有多远 |
| --- | --- | --- |
| `asrEnable=false`（case 08） | `ℹ️ 本视频无字幕，点击下方「AI 转写」可语音生成字幕` | 「无字幕」是错的，是「不让播」 |
| **默认**（`asrEnable/asrFallback=true`，case 16） | `⚠️ 未配置 AI API Key（⚙ 设置 → 选厂商并填入 Key；…）` | 完全跑偏：跟 Key 无关 |

**根因**：
- `adapters.youtube.resolve()`（**2037-2065 行**）只读 `videoDetails` 与 `captions.playerCaptionsTracklistRenderer.captionTracks`（**2050-2052 行**），**全文没有任何一处引用 `playabilityStatus`**（已 grep 确认：`grep -c "playabilityStatus" bili-subtitle.user.js` = `0`）。
- 「无字幕」文案是硬编码常量（**4528 行** `state.noSub` 分支），不区分站点。
- 默认设置下连 `noSub` 都走不到：3650-3651 行 `else if (SETTINGS.asrEnable) { await runAsr(); }` 先把用户推去 ASR，于是错误再被 F3 的机制换成 AI Key 文案。

**建议**（三处小改，不动架构）：
1. `resolve()` 里顺手读一下 `yd.playabilityStatus`，把 `status` / `reason` 存进 `state.playability = { status, reason }`；
2. `getSubtitles()` 的分支（**3650-3654 行**）先判 `state.playability && status !== 'OK'`，命中就 `state.err = 'YouTube 拒绝播放：' + reason`（明确报错，且**在 asrEnable 分支之前**判，避免被推去 ASR）；
3. 4528 行按 `state.adapter.id` 分文案：`youtube` 时不要提「AI 转写」，改成「本视频在 YouTube 侧没有可下载的字幕轨道（直播/受限视频常见）」。

---

### F3　默认设置下，字幕接口 403 会被 ASR 回退吞掉

**现象**：同一个 403 场景，两种设置两种结果：

| 设置 | 界面文案 |
| --- | --- |
| `asrFallback=false`（case 09） | `⚠️ 提取失败：HTTP 403` ← 真实、可诊断 |
| `asrFallback=true`（**默认值**，case 10） | `⚠️ 未配置 AI API Key（⚙ 设置 → 选厂商并填入 Key；GitHub 注册送 ¥16 代金券（邀请码 axOmWfWi））` ← 与真实原因无关 |

用户拿着默认设置遇到 403（YouTube 风控/需要 po_token 时很常见），看到的是「去配 AI Key」，配完再点还是失败（因为 YouTube 本来就取不到音频，2082 行）。而且这条文案里还夹了一句代金券邀请码，出现在一个**根本不是计费问题**的报错位——这是最容易被当成「脚本在推销」的地方。

**连带影响**：受限视频（case 16）也是这套机制的受害者——`captions` 为空 → 走 `asrEnable` 分支 `runAsr()`（3650-3651 行）→ 失败 → catch → `asrFallback` 再进一次 `runAsr()` → 最终留下面板里的 AI Key 文案。

**根因**：`getSubtitles()` 的 catch（**3655-3666 行**）：

```js
} catch (e) {
  log(e);
  ...
  if (SETTINGS.asrFallback && !state.asrRan && !state.body) {
    state.err = '';           // ← 先把真实错误清掉
    await runAsr();           // ← 再去跑一个注定失败的流程
    return;
  }
  state.err = '提取失败：' + e.message;
```

`asrFallback` 对所有错误一视同仁：网络 403、解析空、依赖缺失，全都转去 ASR，原始 `e.message` 被丢掉。

**建议**：
1. 只对「**取到了但为空**」和「**网络抖动**」类错误回退 ASR，4xx（403/404/410）直接报错，并附一句可操作提示（如「YouTube 返回 403，通常是风控/登录态问题，请刷新页面或先登录」）；
2. `runAsr()` 失败时把**原始错误**拼进去：`state.err = '提取失败：' + e.message + '（AI 转写也未成功：' + asrErr.message + '）'`，别只留最后一条；
3. YouTube 适配器在 `getAudio()` 返回 `null` 时干脆不触发 ASR 回退（`ad.id === 'youtube'` 直接跳过），省一次注定失败的流程和一次误导文案。

---

### F4　陈旧 playerResponse 时，标题/作者也一起「陈旧」

**现象**：case 07 地址栏是 `watch?v=bbbbbbbbbbb`，页面里 `ytInitialPlayerResponse.videoDetails.videoId` 仍是 `dQw4w9WgXcQ`。字幕侧**正确**地丢弃了轨道（`ℹ️ 本视频无字幕`），但面板标题仍然是 `Rick Astley - Never Gonna Give You Up (Official Music Video)`——上一条视频的标题。

**根因**：**2044-2052 行**只给 `tracks` 做了 `stale` 守卫：

```js
var stale = !!(vm && vd.videoId && vm[1] !== vd.videoId);
...
if (stale) tracks = [];   // 只清了字幕轨道
```

而 `state.title / state.up / state.duration` 在 **2046-2048 行**已经被 `vd.*` 无条件写入了，没有跟着 `stale` 一起清。

**影响**：SPA 站内切视频的瞬间（YouTube 走 `yt-navigate-finish`，脚本 4821-4825 行监听了），如果 playerResponse 还没刷新，用户会看到「新视频的 URL + 旧视频的标题 + 无字幕」。标题错了会直接导致导出文件名错。

**建议**：`stale` 为真时把 `title/up/duration` 也一起判为不可信：

```js
if (stale) { tracks = []; state.title = ''; state.up = ''; state.duration = 0; }
```

这样会走到 2049 行已有的兜底 `document.title.replace(/\s*-\s*YouTube$/,'')`，至少拿到当前页面的标题。

---

## 4. 附带观察（不是缺陷，但用户会感知）

**O1　「字幕增强」默认把 6 条并成 3 条。** case 01（默认 `polishOn=true`）显示 3 行 90 字，case 13（关掉）显示 6 行 84 字，内容一致只是合并方式不同。合并会让「点某一行跳到对应时间」的粒度变粗（3 行覆盖 22 秒），且状态栏「✅ 3 句」会让人以为只抓到 3 句。这属于产品取舍，不是 bug，但如果用户反馈「字幕条数不对」，根因在这里。相关代码：`maybePolish()` 3443-3455 行 → `TranscriptQuality.polishBody`。

**O2　YouTube 的「字幕可能不完整」判定依赖 `lengthSeconds`。** 直播（case 04）`lengthSeconds=0` 时不告警；点播视频若 `lengthSeconds` 缺失/为 0，`checkIntegrity`（1641-1646 行）直接返回 false，同样的不完整就**不会**告警。属于「静默放过」，量级很小，记一笔。

---

## 5. fixture 清单与「我凭什么这么造」

| 文件 | 用途 | 依据（哪些字段有把握 / 哪些是推测） |
| --- | --- | --- |
| `yt-watch.html` | watch 页全量 | **有把握**：`var ytInitialPlayerResponse = {...}` 挂在 classic `<script>` 里（`var` 故成为 window 属性）；`videoDetails.{videoId,title,author,lengthSeconds}`；`captions.playerCaptionsTracklistRenderer.captionTracks[].{baseUrl,languageCode,kind,name.simpleText,vssId}`；`kind:'asr'` 表示自动字幕。**推测**：`pot` / `xoaf` / `ipbits` / `key=yt8` / `sparams` 的参数组合（随版本变，与被测逻辑无关） |
| `yt-embed.html` / `yt-shorts.html` / `yt-live.html` / `yt-nocookie-embed.html` | 其余 4 种 URL 形态 | 结构与 watch 页一致，**裁剪**掉 `streamingData`/`microformat` 等与字幕无关的键（保留 `videoDetails` + `captions`）。**推测**：Shorts 页真实还带 `ytInitialData.reelPlayerHeaderRenderer`，本 fixture 未还原（被测代码不读它） |
| `yt-watch-restricted.html` | 受限视频 | **有把握**：受限时 `playabilityStatus.status` 非 `OK`（`UNPLAYABLE`/`LOGIN_REQUIRED`/`AGE_VERIFICATION_REQUIRED`）且带 `reason`，`captions` 键通常不存在。**推测**：`messages[]` 的具体形态 |
| `yt-youtu-be.html` | 短链「重定向尚未发生」态 | **有把握**：youtu.be 返回 303，脚本运行在 youtu.be 上时页面无 playerResponse |
| `yt-youtu-be-redirect.html` | 短链跳转后 | 用 `location.replace()` 模拟 303（原因见 1.4-2） |
| `yt-timedtext-zh-Hans.ttml` / `-en.ttml` | 字幕正文 | **有把握**：`<tt xmlns="http://www.w3.org/2006/10/ttaf1" …><head><styling><style/></styling></head><body><div><p begin="HH:MM:SS.mmm" end="HH:MM:SS.mmm" >文本</p>`，属性就是 `begin`/`end`（少数用 `dur`）。**推测**：`<style>` 上 `tts:*` 风格属性集合 |
| `yt-timedtext-comment.ttml` | F1 复现 | 带 XML 注释的 TTML；**非 YouTube 现实场景**，用于说明解析器的通用健壮性 |
| `generic-track.html` + `generic-sub.vtt` | 通用站点 A | HTML5 标准 `<track kind/srclang/label src>` + 标准 WebVTT（含 `NOTE` 块、cue 标识行、`<i>` 内联标签）。VTT 由同源 HTTP 以 `text/vtt` 提供 |
| `generic-texttracks.html` | 通用站点 B | `video.addTextTrack('captions', label, lang)` + `VTTCue`，DOM 里无 `<track>`（video.js/Plyr/DPlayer 的常见做法） |

---

## 6. 怎么复现

```bash
cd C:\Users\Administrator\WorkBuddy\gh-optimizer\bili-subtitle-universal
export NODE_PATH="C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules"
"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" scripts/verify/run-youtube-verify.js
```

- 脚本会自己起一个 `127.0.0.1:8899` 的静态服务（通用站点用例用），跑完自动关。
- Chromium 用 `ExecutablePath` 指向本机 `ms-playwright/chromium-<最大版本>/chrome-win64/chrome.exe`（playwright 1.64 默认要的 build 号本机没有，直接指定可避免联网下载）。可用 `PLAYWRIGHT_CHROMIUM` 环境变量覆盖。
- 输出：控制台 16 行用例结果 + `scripts/verify/verify-results.json`（每条含 `status / lines / srt / lanOptions / captured`）+ `scripts/verify/shots/yt-*.png`。

已确认既有单测仍然通过：`node tests/test-site.js` → `PASS 25/25`。

---

## 7. 未验证项（不许含糊）

| # | 项目 | 为什么没验 | 现有证据能推到哪一步 |
| --- | --- | --- | --- |
| **N1** | 真实 YouTube 上的完整链路（真 watch 页 → 真 captionTracks → 真 timedtext） | 本机 `youtube.com` 完全不可达（curl `000`，8s 超时）。**没有任何一条结论来自真网** | 只能证明「给定当前已知结构的响应，脚本逻辑正确」。若 YouTube 改了 `baseUrl` 的鉴权参数（如现在需要 `pot` / `po_token`）或改回非 TTML 的响应格式，本报告的 PASS 不代表线上可用。**这条必须由能联网的人在真机浏览器里复核**，重点看 `fmt=ttml` 是否仍被接受、`baseUrl` 是否仍直接可用（会不会 403） |
| **N2** | 真正的付费/会员/年龄限制视频 | 受限场景只造了 `playabilityStatus.reason` 的 fixture，没有造出「能播但字幕要付费/租借」的组合；也不掌握真实付费视频的响应结构 | 只能证明「`captions` 缺失时脚本显示无字幕」；不能证明「付费视频的 `captions` 长什么样、脚本会不会误判」。F2 的修法建议（读 `playabilityStatus`）不受此限制 |

另外两项**性质上是「验证到了，但结论受限」**，不算未验证：

- **直播（N/A 部分）**：case 04 证明了 `/live/` 这个 URL 形态走得通，但真实直播流极大概率没有 `captionTracks`（字幕是另一条实时通道）。真实直播的表现**未验证**。
- **YouTube ASR**：`getAudio()` 恒 `null`（2082 行），所以「YouTube 无字幕 → AI 转写」这条路**在所有情况下都走不通**。这不是「没验」，是**验到了、确认不可用**，并且已作为 F2/F3 的依据。

---

## 8. 汇总建议优先级

| 优先级 | 项 | 理由 |
| --- | --- | --- |
| P0 | **F2** 受限视频误报 + 指向死路 | 用户被明确误导，且给出的是不可执行的动作 |
| P0 | **F3** 403 被 ASR 回退吞掉 | 默认设置下就中招；报错位出现代金券文案，体感最差 |
| P1 | **F4** 陈旧标题 | SPA 切视频时标题/导出文件名错，字幕侧已有守卫、标题侧漏了，改动 1 行 |
| P2 | **F1** TTML 注释被当字幕 | YouTube 上不触发，通用 TTML 站会中；修法 2 行 |
