# 浏览器真机验证报告 · bili-subtitle-universal v9.16.1

> 验证者：general-purpose-1  
> 验证时间：2026-10-19  
> 被测文件：`bili-subtitle.user.js`（229,962 bytes，v9.16.1，**验证期间未做任何修改**）  
> 验证方式：Playwright + 真实 Chromium 打开**真实 B 站视频页**，注入 GM API 打桩后执行主脚本，用 DOM 取值 + 截图取证。

---

## 0. 一句话结论

**P0 回归（「状态栏说 N 句、预览区一个字没有」）已修复，有截图为证**：`#bsrOut` 内实测 10 条 `.bsr-line`，每条 `.bsr-tx` 均有中文正文、`emptyTxCount = 0`，截图里能看清「大家好，这一期我们来讲字幕提取到底是怎么做的。」等原文。

同时发现 2 个真实存在的次生缺陷（都在 B 站链路，不是渲染层），见 §4。

---

## 1. 测试环境与「真网 / fixture」边界（先讲清，避免误读）

| 环节 | 来源 | 说明 |
|---|---|---|
| 页面 HTML / 静态资源 / 播放器 / `<video>` | **真网** | `https://www.bilibili.com/video/BV1GJ411x7h7` 真实加载，`document.querySelectorAll('video').length = 1`，`readyState = 4` 且在播放 |
| 全部 `GM_xmlhttpRequest` | **真网** | 打桩后转交 Node 侧 `fetch` 直连 `api.bilibili.com`，无 CORS 限制。日志里每条请求都是真实 HTTP |
| `player/wbi/v2` 的 `subtitle.subtitles` 数组 | **fixture** | 未登录拿不到字幕轨（见 §3.1），故在**真实响应体上**把该数组补成 1 条轨，其余字段全真 |
| 字幕 JSON 文件 | **fixture** | `//i0.hdslb.com/bfs/subtitle/browser-verify-fixture.json` 由此场景的 Node 路由返回。结构照 B 站真实返回：`{font_size, font_color, background_alpha, Stroke, body:[{from,to,location,content}]}` |
| 其余一切（解析、合并、渲染、检索、导出、点击跳转） | **真脚本代码** | 未打任何补丁，跑的就是仓库里那份 IIFE |

**为什么必须用 fixture 补这一步（诚实交代）**：实测 B 站对未登录请求返回 `need_login_subtitle: true` 且 `subtitles: []`，无论怎么挑视频都拿不到字幕轨（见 §3.1 原始响应）。这是环境限制，不是脚本 bug。**如果没有这一步，本次就无法回答「预览区到底有没有字」这个核心问题** —— 而那正是用户抱怨的点。

视频：`BV1GJ411x7h7` · aid `80433022` · cid `137649199` · 时长 `213s` · UP「索尼音乐中国」。

运行命令（可复现）：

```bash
cd C:/Users/Administrator/WorkBuddy/gh-optimizer/bili-subtitle-universal
NODE_PATH=C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules \
  C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6/node.exe \
  scripts/verify/browser-verify.js
```

（Playwright 1.64 期望 chromium-1248，本机缓存只到 1234，脚本已显式指定 `executablePath` 到 `chromium-1234/chrome-win64/chrome.exe`。）

---

## 2. 结果总表

| # | 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | 脚本能在真实页面注入并生成悬浮胶囊 | 真网 | **PASS** | `#bsr-root` / `#bsr-fab` 存在；`shots/browser-01-panel.png` |
| 2 | **预览区真的显示字幕文字（P0 回归）** | 真网 + fixture 字幕轨 | **PASS** | `.bsr-line = 10`、`空正文行 = 0`；`shots/browser-02-preview.png`、`shots/dom-lines.txt` |
| 3 | 每行 `.bsr-tx` 正文非空且是原始中文 | 同上 | **PASS** | 前 3 条：`大家好，这一期我们来讲字幕提取到底是怎么做的。` / `先说结论：有官方字幕就直接拉官方字幕，没有才用语音转写。` / `B 站的字幕接口需要 WBI 签名，丢了签名会被风控拦掉。` |
| 4 | `.bsr-ts` 时间戳形如 mm:ss | 同上 | **PASS** | 前 3 条 `0:01` `0:04` `0:08`；全 10 行 100% 匹配 `/^\d{1,2}:\d{2}(:\d{2})?$/`（`tsAllMatchFormat = true`） |
| 5 | 状态栏句数/字数与渲染行数一致 | 同上 | **PASS** | `✅ 10 句 · zh-CN · 277 字` vs 实际 10 行；复制 toast 同为「已复制 277 字」 |
| 6 | 复制到剪贴板内容真实 | 同上 | **PASS** | `navigator.clipboard.readText()` 长度 305，首行即第一条字幕原文 |
| 7 | SRT 导出内容正确 | 同上 | **PASS** | Blob 1124B，`1\n00:00:01,020 --> 00:00:04,350\n大家好，这一期…` |
| 8 | **点预览行跳转视频** | 同上（真实 `<video>`） | **PASS** | 点第 4 行（`data-from=12.66`）→ `currentTime` 由 `7.44` 变 `13.77`，`.cur` 高亮生效，toast「已跳到 0:12」。偏差 1.108s 是点击后视频继续播放的时间，非误差 |
| 9 | **无字幕时隐藏「⏱ 时间轴」** | 真网（无字幕）vs fixture（有字幕） | **PASS** | 无字幕：`#bsrAxisToggle` 计算样式 `display: none`；有字幕：`display: block` |
| 10 | **检索只留命中行** | 真网 + fixture 字幕轨 | **PASS** | 输入「字幕」：10 → **5 行**（`.hit` 5 条）；无意义词：回退 10 行不空白；清空：10 行 |
| 11 | 检索命中时「复制」只出命中行 | 同上 | **PASS** | 剪贴板 5 行；提示「命中 5 / 10 条（0:01 ~ 0:32） · 复制与导出只出命中行」 |
| 12 | 「进入视频自动获取字幕」存在且默认关 | 真网 | **PASS** | `#bsrAutoFetch` 存在、`checked = false`；文案「进入视频自动获取字幕并复制到剪贴板（默认关，开启即自动取+复制）」；`shots/browser-03-settings-box.png` |
| 13 | 真网「有官方字幕」端到端（未登录） | 真网 | **未验证** | B 站返回 `need_login_subtitle: true`、`subtitles: []`，环境无 SESSDATA，**无法**取得真实字幕轨（详见 §3.1） |
| 14 | WBI 签名链路是否真的生效 | 真网 | **FAIL（健壮性）** | 未登录时脚本整段跳过 WBI，静默降级到无签名接口（详见 §4.1） |
| 15 | 未登录场景的提示文案是否准确 | 真网 | **FAIL（UX）** | 说「本视频无字幕」，实际是「需登录才能读字幕轨」（详见 §4.2） |

---

## 3. 核心问题的实证细节

### 3.1 先说真网基线：未登录拿不到字幕轨

真实请求（Node 直连，非浏览器）与浏览器内脚本请求结果一致：

```json
// GET https://api.bilibili.com/x/player/wbi/v2?bvid=BV1GJ411x7h7&cid=137649199&isGaiaAvoided=true&w_rid=da545c6c906127136748bc5427c62511
{ "code": 0, "message": "OK",
  "data": { "need_login_subtitle": true,
            "subtitle": { "allow_submit": false, "lan": "", "lan_doc": "", "subtitles": [] } } }
```

另外抽检了 5 组关键词、共 40 个公开视频（TED / 李永乐 / 3Blue1Brown / 科普 / 纪录片），`subtitles` 全部为 `[]`，`need_login_subtitle` 全为 `true`。所以不是「挑错了视频」，是这台机器没有 B 站登录态。

→ **真网无字幕时的正确表现**（场景 REAL）也确实正确：状态栏 `ℹ️ 本视频无字幕，点击下方「AI 转写」可语音生成字幕`，`#bsrOut` 显示视频信息占位（`browser-02-preview-real.png`），不报错、不假装成功。

### 3.2 补上字幕轨后：预览区到底有没有字

DOM 客观取值（`#bsrOut` 内）：

```
lineCount       = 10
emptyTxCount    = 0          ← 关键：一条空正文都没有
tsAllMatchFormat= true
status          = "✅ 10 句 · zh-CN · 277 字 ⚠️ 字幕可能不完整"
```

`shots/dom-lines.txt` 全文（`时间戳 \t 正文`）：

```
0:01	大家好，这一期我们来讲字幕提取到底是怎么做的。
0:04	先说结论：有官方字幕就直接拉官方字幕，没有才用语音转写。
0:08	B 站的字幕接口需要 WBI 签名，丢了签名会被风控拦掉。
0:12	拿到字幕地址之后是一个 JSON，里面每一条都有起止时间和正文。
0:17	我们把这些条目渲染成可以点击的行，点一下就跳到视频对应位置。
0:22	导出支持 TXT、SRT、VTT、Markdown 和 AI 纯文本五种。
0:27	最后提醒一句：预览区看得见文字，才算真的取到了字幕。
0:32	不然状态栏说几句 успешно 也没用，眼睛是骗不了人的。
0:38	这一句是特意混进来的俄文单词，用来验证渲染有没有丢字符。
0:43	十条足够了，再多的部分交给真正的线上数据去检验。
```

截图能直接看到字：`shots/browser-02-preview.png`（预览区特写，6 行可见）、`shots/browser-01-panel.png`（整面板，右侧栏）。

> 第 8 条故意混了 `успешно`，用来验证 `escHtml` + UTF-8 没有吞字符——渲染出来是完整的，说明不是「只渲染了 ASCII 安全字符」的假通过。

### 3.3 `⚠️ 字幕可能不完整` 不是缺陷

`checkIntegrity()`（`bili-subtitle.user.js:1641`）的判据是「最后一条 `to` < 视频时长 × 0.6」。fixture 只有 49.02s，真实视频 213s，49.02 < 127.8 → 如实标记。**属于 fixture 长度造成的正常判定**，换成真实全片字幕不会触发。

---

## 4. 发现的缺陷（附行号与建议）

### 4.1 【P2 · 健壮性】`getWbiKeys()` 把「未登录」误判成「接口失败」，导致 WBI 签名链路被整段跳过

**现象（真机日志，不是读代码猜的）**：

```
[页面日志] [全网字幕] wbi/v2 失败，回退 v2 Error: 获取 wbi key 失败 code=-101
    at <anonymous>:1785:90
    at async Object.fetchSubs
```

随后实际发出的请求列表里**根本没有 `x/player/wbi/v2`**，直接变成：

```
GET https://api.bilibili.com/x/web-interface/nav                  -> 200 (249B)
GET https://api.bilibili.com/x/player/v2?bvid=...&cid=...         -> 200 (2699B)   ← 无签名旧接口
```

**根因**：`bili-subtitle.user.js:1785`

```js
if (d.code !== 0 || !d.data || !d.data.wbi_img || !d.data.wbi_img.img_url)
  throw new Error('获取 wbi key 失败 code=' + d.code);
```

`/x/web-interface/nav` 的 `code` 表示**登录态**（`-101 = 账号未登录`），而不是接口可用性。实测未登录时它**依然返回完整的 `data.wbi_img`**：

```json
{"code":-101,"message":"账号未登录",
 "data":{"wbi_img":{"img_url":".../7cd084941338484aae1ad9425b84077c.png",
                    "sub_url":".../4932caff0ff746eab6f01bf08b70ac45.png"}}}
```

于是 `throw` → `fetchSubs` 的 try/catch 吞掉 → 整个 WBI 分支被跳过 → 走无签名的 `/x/player/v2`。

**我做了反证，证明签名实现本身是对的**（场景 WBI）：把 nav 的 `code` 从 `-101` 改成 `0`（保留真实 `wbi_img`），同一份脚本代码立刻发出：

```
GET https://api.bilibili.com/x/player/wbi/v2?bvid=...&cid=...&isGaiaAvoided=true&w_rid=da545c6c906127136748bc5427c62511
-> code: 0, message: "OK"      ← 真实 B 站服务器接受了脚本自己算出来的 w_rid
```

**影响**：未登录用户永远走无签名接口，风控一收紧就是 `-352/-412`（而脚本对 `-403` 才重取 key，对 `-352` 无处理）；更麻烦的是排查时会误以为「WBI 已经生效了」。

**建议改法**（一处，最小改动）：

```js
// 原
if (d.code !== 0 || !d.data || !d.data.wbi_img || !d.data.wbi_img.img_url) throw ...
// 改为：只看 wbi_img 在不在，code 是登录态不是可用性
if (!d.data || !d.data.wbi_img || !d.data.wbi_img.img_url) throw new Error('获取 wbi key 失败 code=' + d.code);
```

### 4.2 【P2 · UX】`need_login_subtitle` 完全没被处理，提示文案误导用户

**证据**：`grep -n "need_login_subtitle" bili-subtitle.user.js` → **0 处命中**；而真实响应里该字段恒为 `true`。状态栏因此输出「ℹ️ 本视频无字幕」，用户会以为视频真没字幕，被引导去烧 AI 转写额度。

**建议**：`fetchSubs()`（`bili-subtitle.user.js:1974-2009`）把 `d.data.need_login_subtitle` 一并带出，`render()`（`:4528` 的 `state.noSub` 分支）区分两种情况：

```
need_login_subtitle === true → "ℹ️ 该视频的字幕轨需要登录 B 站账号才能读取（当前未登录），可改用 AI 转写"
否则                          → 现有的"本视频无字幕"
```

### 4.3 【P3 · 一致性】无字幕时「导出按钮行」仍然显示

`bili-subtitle.user.js:4672` 无条件执行 `$('#bsrOps').style.display = 'flex';`，而同段代码里 `#bsrFindRow`（`:4635`）和 `#bsrAxisToggle`（`:4638`）都按 `state.body` 收敛。

**实测**：REAL 场景（`lineCount = 0`）下 `#bsrOps` 计算样式仍是 `flex`，7 个导出按钮全亮着。点 TXT/SRT/VTT/MD 都是 `if (state.body)` 直接 return —— **点了没有任何反应也没有提示**，是最容易被当成「按钮坏了」的那种沉默失败；只有「📋 复制」会退化成复制视频信息（`:4235`，这是有意设计）。

**建议**：与时间轴保持一致 —— `$('#bsrOps').style.display = state.body ? 'flex' : 'none';`，或至少把无字幕时的 4 个空操作按钮置灰并加 `title`。

---

## 5. 未验证 / 无法验证的项（如实列）

| 项 | 原因 |
|---|---|
| 真网「有官方字幕」的完整链路（`subtitle_url` → 真实字幕 JSON） | B 站对未登录请求返回 `need_login_subtitle: true`、`subtitles: []`。本机无 `SESSDATA`。**这是本次唯一的硬限制**，故改用「真实响应体 + 注入字幕轨」的方式，并在 §1 明确标注 |
| 多语言字幕轨切换（`#bsrLan`） | 依赖上面的真实多轨数据，fixture 只注入了 1 条轨 |
| AI 转写 / 翻译 / LLM 纠错 | 需 API Key，且会烧额度；本次已主动关闭（`bsr_asr_enable/fallback/force = false`）以保证测试确定性 |
| 深色模式、快捷键、VTT/MD/TXT 三种导出 | 非本次重点，未逐项跑（SRT 已作为代表验证） |
| YouTube / 通用站点 | 本 agent 不涉及；环境实测 `youtube.com` 不可达（HTTP 000） |

---

## 6. 产物清单

截图（`scripts/verify/shots/`）：

| 文件 | 内容 |
|---|---|
| `browser-01-panel.png` | 面板整体，右侧栏可见字幕行 + 时间戳 |
| `browser-02-preview.png` | **预览区特写**（P0 核心证据，中文字清晰可读） |
| `browser-03-settings.png` | 设置面板展开后的整页 |
| `browser-03-settings-box.png` | 设置面板特写，可见「进入视频自动获取字幕…（默认关）」未勾选 |
| `browser-04-export.png` | 导出按钮行特写 |
| `browser-01-panel-real.png` / `browser-02-preview-real.png` | 真网无字幕场景（对照） |
| `dom-lines.txt` | 10 行 `时间戳 \t 正文` 原文 |
| `browser-verify-result.json` | 三场景完整 DOM 断言 + 网络日志 + 控制台日志 |

脚本（`scripts/verify/`，保留供复用）：

| 文件 | 用途 |
|---|---|
| `browser-verify.js` | 主验证脚本（三场景：real / wbi / fixture + 6 项交互断言） |
| `probe-net.js` / `probe-subs.js` / `probe-find.js` / `probe-diag.js` | 前置网络探针，用于确认可达性、WBI 可用性、`need_login_subtitle` 判定 |

**仓库源码零改动**：`git status --porcelain` 仅输出 `?? scripts/verify/`。
