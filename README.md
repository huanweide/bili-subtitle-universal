<p align="center">
  <img src="assets/banner.svg" alt="bili-subtitle-universal — 全网视频字幕全能提取">
</p>

# 🎬 全网视频字幕提取 · AI 转写版

> **不是「又一个 B 站字幕脚本」——是「没字幕也能出字」的那一个。**
> 有官方字幕就秒取，没有就用 AI 听写，**3 小时长视频也能稳稳跑完**。

[![CI](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml/badge.svg)](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/version-9.17.1-FB7299)](https://github.com/huanweide/bili-subtitle-universal)
[![license](https://img.shields.io/badge/license-MIT-4ecca3)](LICENSE)
[![tests](https://img.shields.io/badge/tests-86%2F86-3a8ee6)](tests/run-tests.js)
[![userscript](https://img.shields.io/badge/Tampermonkey-Edge%20%7C%20Chrome%20%7C%20Firefox-7C5CBF)](https://www.tampermonkey.net/)


**自动流程**：`打开视频页 → 🎬 点开面板 → ⚡ 获取字幕 →（无字幕时）🎙 AI 转写 → 📋 复制 / ⬇ SRT·VTT·MD`

[30 秒看懂](#30-秒看懂) · [它能做什么](#它能做什么) · [特性](#特性-features) · [快速开始](#快速开始-quick-start) · [架构](#架构-architecture) · [边界](#安全边界) · [路线图](#路线图-roadmap) · [贡献](#贡献-contributing)

---

## 30 秒看懂

```text
之前 · 一个 3 小时无字幕的讲座视频
─────────────────────────────────────────────
  你      边看边暂停，手打字幕            →  一整晚
  别的脚本  「本视频无字幕」然后没下文       →  死路
  本脚本    🎙 AI 转写 → 分段解码 → 断点续传 →  3 小时后你有一份完整稿子

之后 · 终端里真正发生的事
─────────────────────────────────────────────
$ 打开 https://www.bilibili.com/video/BV…
  右下角出现「🎬 字幕」胶囊

$ 点「⚡ 获取字幕」
  ✔ 命中官方字幕（中文·人工）· 1,284 条      ← 无 Key、不花钱、秒出

$ 若是无字幕视频 → 点「🎙 AI 转写」
  ① 下载  ② 读时长  ③ 分段解码  ④ 转写  ⑤ 合并
  音频 86MB · 时长 3:33:00 · 已处理 1:12:30 / 3:33:00 · 已用 2:14 · 预计还需 4:06
  [00:00:03] 你好，欢迎来到本期节目
  [00:00:08] 上一节我们讲到了电子排布
  [00:00:15] 现在来看第二主族

$ 导出
  📋 复制 · ⬇ TXT（带 BOM） · ⬇ SRT · ⬇ VTT · ⬇ MD · 🤖 AI 文本 · ⚓ 锚点稿
```

**一句话差别**：别的工具止步于「取官方字幕」，本脚本把「没有字幕」这条死路接成了活路。

---

## 它能做什么

**场景 1 · B 站课程做笔记**（UP 主没传字幕）

```
User: 打开 BV 号的课程页
  → 认领：/video/BV… 命中 B 站规则表（modules/site-match.js）
  → 取字幕：WBI 签名调官方接口 → 无字幕
  → 兜底：读 DASH 分片目录 → 逐片下载 + 逐片解码 → 每 2 分钟送一次 ASR
  → 落盘：TXT / SRT，断点可续
```

**场景 2 · YouTube 视频要文字稿**

```
User: 打开 youtube.com/watch?v=…
  → 认领：/watch?v= 命中 YouTube 规则表
  → 从播放器响应里解析字幕轨道（TTML 双形态时间戳全兼容）
  → 自动字幕标注为 AI，导出 SRT / VTT 挂播放器
```

**场景 3 · 别人博客里嵌的播放器 / 任意网页 `<video>`**

```
User: 打开一个嵌了 player.bilibili.com/player.html 的网页
  → 认领：iframe 嵌入播放器（v9.8 起）→ 从 URL 参数取 BV 号
  → 通用站：遍历页面所有 <video>，扫 <track kind="subtitles|captions">
  → 解析 WebVTT / SRT
```

---

## 特性 / Features

- **认领表引擎 (SiteMatch)** — 站点与页面形态的识别集中成一张可测试的表，不再散在正则里；没有播放器的页面一律不认领——认领了却取不到字幕，比不认领更伤信任。见 `modules/site-match.js`
- **四层转写防线 (fallback ladder)** — 分段解码（首选，不播放、内存恒定）→ 整段直传（≤40MB）→ 解码切片（16kHz）→ 静音播放录制（兜底）；前一路不通自动走下一路，一条路堵不死
- **断点闸门 (SegResume)** — 每批约 2 分钟音频转完即落盘，刷新 / 误关 / 断网后重转自动跳过已完成部分，**不花第二遍钱**；断点按「BV 号 + P 号 + 音频地址」识别，24 小时有效
- **厂商无关层 (AI_PROVIDERS)** — 转写与翻译的厂商可切换（硅基流动 / OpenAI / DeepSeek / OpenRouter / 自定义 OpenAI 兼容端点），Key 与模型在设置里随手改；DeepSeek 明确标记无音频端点，避免点了转写却 404
- **三层质量层 (TranscriptQuality)** — 第 1 层热词注入（词来自视频自己的标题/简介/标签，**免费**，账号不支持自动降级）→ 第 2 层 LLM 纠错（默认关，按调用计费，条目数/顺序一变整批拒绝）→ 第 3 层标点恢复 + 断句合并 + 相邻重复行去重（默认开）
- **检索即导出范围 (search-as-scope)** — 字幕内检索多词「与」语义，命中 N 行，**复制 / TXT / SRT / VTT / AI 文本 / 锚点稿全部只出命中行**；一条没命中时回退全文，宁可多给不给空文件
- **锚点免疫系统 (RouteIdentity)** — `?t=120` / `spm_id_from` / `vd_source` 一律不参与「换没换视频」的判断，只有真换视频或换分 P 才重置；点评论区时间戳不再清空字幕
- **证据矩阵门禁 (test-claims)** — README 承诺的每一条都必须能在源码里指到一行证据，**写了却没实现，测试直接红**
- **纯前端边界（默认）** — 没有服务器，设置与 API Key 只存在 Tampermonkey 本地沙箱；源码里不存在向自有服务 fetch 的行为（有断言守着）

---

## 快速开始 / Quick Start

### 第 1 步 · 装 Tampermonkey

Edge / Chrome / Firefox 应用商店搜「Tampermonkey」一键安装。

### 第 2 步 · 装脚本

```text
打开 bili-subtitle.user.js → 全文复制 → Tampermonkey「新建脚本」→ 粘贴 → 保存
```

或走 CDN 安装链接（自动更新依赖它）：

```
https://cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@main/bili-subtitle.user.js
```

### 第 3 步 · 用（只用官方字幕的话，到此为止，不需要 Key）

打开任意带视频的网页 → 右下角出现 **🎬 字幕** 胶囊 → 点开 → **⚡ 获取字幕**。

```text
✔ 命中官方字幕（中文·人工）· 1,284 条
  已复制到剪贴板
```

### 第 4 步 · 可选：配 AI Key（只有转写 / 翻译才需要）

去任意一家开 OpenAI 兼容接口的厂商拿 Key（默认 [硅基流动](https://cloud.siliconflow.cn/i/axOmWfWi)，GitHub 注册送 ¥16 代金券），
进面板 ⚙ 设置 → 选「AI 厂商」→ 粘贴 `sk-` 开头的 Key → 点「测试连接」先验有效性（不烧额度）→ 点 **🎙 AI 转写**。

```text
[4/5] 转写中 · 批次 12/107 · 已完成 24:00 / 3:33:00
[00:24:03] 我们刚才说的这个能级交错现象
```

> ⚠️ 「无字幕时自动转写」**默认关**：无字幕只提示、不自动开跑，避免偷偷烧你的额度。

### 自测：本地跑一遍测试电池

```bash
node --check bili-subtitle.user.js   # 语法
node tests/run-tests.js              # 86 项单元测试
node tests/test-claims.js            # README 承诺 → 源码证据矩阵
node tests/check-docs.js             # 版本号 / 测试数不得漂移
```

```text
结果：86 通过，0 失败
----------------------------------------
PASS 89 条（全部通过）
结果：全部一致（版本 9.17.1 · 用例 86）
```

---

## 命令速查 / Command Reference

| 命令 | 用途 |
|---|---|
| `node tests/run-tests.js` | 单元测试：MD5 / WBI / SRT / VTT / TTML / WAV / MIME / 选路 / 声道 / 长音频硬化 |
| `node tests/test-scorer.js` | 候选评分 / 搜索筛选纯函数 / 转写质量 / 断点续传状态层 |
| `node tests/test-wiring.js` | 接线验证：模块有定义还必须有调用方，UI 元素两侧都要在 |
| `node tests/test-route.js` | 路由身份（锚点 / 追踪参数 / 换 P）+ 导出动作分派，含反向断言 |
| `node tests/test-ui.js` | 深色模式覆盖完整性 / FAB 可见文字 / 无障碍 / 交互反馈 |
| `node tests/test-site.js` | 站点与页面形态认领 / 不认领清单 / 钓鱼域名 / URL 消毒 |
| `node tests/test-sub.js` | 字幕内检索 / VTT·MD 导出 / 快捷键 / 点击跳转 / AI 提示词 / 时间轴校正 |
| `node tests/test-claims.js` | 全功能验证矩阵：README 每条承诺都要能在源码里指到证据 |
| `node tests/test-roundtrip.js` | 导出 → 再解析往返一致（SRT / VTT 写出来再读回来逐条相同） |
| `node tests/check-docs.js` | 文档一致性门禁：版本号 / 测试数漂移即红 |
| `node build.js` | 把 `modules/*.js` 同步进 `bili-subtitle.user.js` 的 build:modules 区 |
| `node scripts/cdn-refresh.js` | ⚠️ 每次 push 后必跑：purge jsDelivr 缓存并校验 CDN 版本 |
| `node tests/serve.js` | 本地静态服务（8765）配合 `tests/test.html` 灰度 |

**快捷键**：`Alt+S` 开合面板 · `Esc` 收起 · `Ctrl/⌘+Enter` 取字幕（输入框内不抢键，可整个关掉）

---

## 架构 / Architecture

**一句话**：字幕提取走「认领表 → 三来源选优 → 四层转写防线」的**降级链**，而不是一条路走不通就报错。长视频的关键不在「更快」，而在**内存恒定 + 断点可续**。

### 概念表 / Primitives

| 概念 | 含义 |
|---|---|
| 认领表 (SiteMatch) | 站点 + 页面形态的规则表；没有播放器就不认领 |
| 视频身份 (RouteIdentity) | 只有「真换视频 / 换分 P」才算换，锚点与追踪参数不算 |
| 四层防线 (fallback ladder) | 分段解码 → 整段直传 → 解码切片 → 静音播放录制，逐层降级 |
| 分段断点 (SegResume) | 每批约 2 分钟音频转完即落盘，重转跳过已完成批次 |
| 候选评分 (CandidateScorer) | 有原生字幕优先 → 默认权重打分 → 播放量，提高命中率少烧钱 |
| 质量三层 (TranscriptQuality) | 热词注入 / LLM 纠错 / 标点断句去重，按需开关 |
| 证据矩阵 (test-claims) | README 的每句承诺都必须能在源码里指到一行 |

### 主流程

```text
打开页面
   │
   ├─ 认领表：这个页面有播放器吗？ ── 否 ─► 不出现按钮（不打扰）
   │
   └─ 是 ─► ⚡ 获取字幕
              │
              ├─ B 站：WBI 签名 → 人工字幕优先于 AI 字幕 → 中文优先
              ├─ YouTube：播放器响应解析 → TTML 双形态时间戳
              └─ 通用站：扫所有 <video> 的 <track> → WebVTT / SRT
              │
              ├─ 有字幕 ─► 解析 → 文本框（可检索 / 可点击跳转 / 可校正时间轴）→ 导出
              │
              └─ 无字幕 ─► 🎙 AI 转写
                            拿到音频地址
                              ├─ 有分片目录 ─► ① 分段解码（首选）
                              ├─ ≤40MB ─────► ② 整段直传
                              └─ 其余 ──────► ③ 解码切片 → ④ 静音播放录制
                            每批完成 ─► SegResume 落盘 ─► 进度条 / 实时字幕流 / 预计剩余
                            中断重来 ─► 跳过已完成批次
```

### 核心模块 / Core Modules

| 模块 | 文件 | 职责 |
|---|---|---|
| 主脚本 | `bili-subtitle.user.js` | 面板 UI、字幕获取、转写编排、导出、设置 |
| 认领表 | `modules/site-match.js` | 站点与页面形态识别 + 视频号抽取与消毒 |
| 路由身份 | `modules/route-identity.js` | 判断「有没有换视频」，锚点不误伤 |
| 断点续传 | `modules/seg-resume.js` | 批次完成落盘、加载、清理，24h TTL |
| 候选评分 | `modules/candidate-scorer.js` | 搜索结果排序（有字幕优先） |
| 搜索筛选 | `modules/search-filter.js` | B 站 wbi 搜索 / YouTube Data API |
| 质量三层 | `modules/transcript-quality.js` | 标点恢复、断句合并、去重 |
| 导出 | `modules/sub-export.js` | TXT / SRT / VTT / MD 与检索过滤后的导出范围 |

---

## 加一个你自己的站点 / 厂商

**加站点**：在 `modules/site-match.js` 的规则表里加一条（站点 + 路径形态 + 视频号抽取方式），
再往 `tests/test-site.js` 补一条认领断言——认领错了比不认领更伤信任，所以必须有测试。

```js
// modules/site-match.js（示意，字段以源码为准）
{ host: /example\.com$/, path: /^\/play\/(\w+)/, pick: (m) => m[1] }
```

**加 AI 厂商**：在 `bili-subtitle.user.js` 的 `AI_PROVIDERS` 里加一个预设：

```js
myvendor: {
  label: '我的厂商',
  base: 'https://api.example.com/v1',
  audio: '/audio/transcriptions', chat: '/chat/completions',
  supportsAudio: true, supportsHotwords: false,   // 能力标记决定 UI 给不给点
  keyPlaceholder: 'sk-...',
  asrModels: ['my-asr-model'], chatModels: ['my-chat-model']
}
```

`supportsAudio` 为 `false` 时（如 DeepSeek）面板会明确提示「该厂商不提供语音转写端点，仅翻译可用」，
不让你点了转写却吃一个 404。

---

## 🎬 还是 🐍？两个字幕项目怎么选

同一作者维护两个字幕项目，**定位不重叠，别选错**：

| | **本仓库 · bili-subtitle-universal**（JS 油猴） | [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor)（Python CLI） |
|---|---|---|
| 形态 | 浏览器里点一下 | 终端里一条命令 |
| 覆盖 | **B 站 + YouTube + 任意网页 `<video>`** | 专注 B 站 |
| 批量 | 单次当前页面 | **一条命令处理多个 BV / `--page all`** |
| 依赖 | Tampermonkey + 浏览器 | **Python 3.10+ 标准库，零 pip 安装** |
| 自动化 | 需人工在页面操作 | **可写进脚本 / 定时任务 / CI** |
| 输出 | 复制 / TXT / SRT / VTT / MD / AI 文本 / 锚点稿 | SRT + TXT + JSON 三件套落盘 |

> **如果你要「批量、离线、能写进脚本」——请用 Python 版 [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor)。**
> **如果你要「打开网页随手点一下，还要覆盖 YouTube / 任意网页」——请用本仓库。**

---

## 常见问题

**Q：提示「未配置 API Key」？** 只用官方字幕不需要 Key。要转写就到 ⚙ 设置粘贴 `sk-` 开头的 Key。

**Q：转写要多久？** 分段解码路（首选）音频处理本身只占几十秒，总耗时基本等于识别服务的时间。

**Q：转写时会有声音吗？** 不会。分段解码根本不播放，兜底路线全程静音（增益 0）。

**Q：YouTube 无字幕为什么不能转写？** YouTube 音频是带签名分片的流媒体，脚本取不到原始音轨，会提示改用官方自动字幕（自动字幕本身已支持）。`MSE` / `blob:` 保护的视频同理。

**Q：B 站要登录吗？** 取 AI 字幕通常需要（浏览器已有登录态即可），人工字幕一般不需要。

**Q：字幕时间轴对不上？** 面板「⏱ 时间轴」→「整体偏移」填秒数（晚了几秒填正数），导出时间戳整体挪过去；起点不会变负，也不会把条目压成 0 秒。

**Q：稿子几千行只想找某几句？** 用文本框上方的检索框，输入即筛，多词空格分开是「与」语义；**检索后所有导出都只出命中行**。

**Q：点了评论区的「02:00」，字幕还在吗？** 在。`?t=` 与分享归因参数不参与换视频判断。

---

## 安全边界

- **纯前端运行**：没有后端服务器，设置与 API Key 只存在浏览器本地沙箱，不上传任何第三方。
- **不下载视频、不转码**：它只处理字幕文字，不做视频下载或破解，不是「下载器」。
- **不替你登录**：取 AI 字幕依赖你浏览器里已有的 B 站登录态，脚本不做登录。
- **计费透明**：AI 听写 / 翻译花的是你自己的额度，长视频走分段断点就是为了少烧钱；不想花就只用免费官方字幕。
- **内容责任**：提取的字幕仅作个人学习与无障碍辅助之用，请遵守《著作权法》与平台规则。

---

## 路线图 / Roadmap

- ✅ v9.0 分段解码 · v9.4 分段断点续传 · v9.6 锚点不误伤 · v9.7 深色模式
- ✅ v9.8 认领表 · v9.9 字幕内检索 + VTT/MD · v9.10 点击跳转 + AI 总结提示词
- ✅ v9.11 时间轴校正 · v9.12 往返一致性 · v9.14 AI 厂商可切换 · v9.17 默认关闭自动转写
- ⬜ **v9.13（下一步）**：真实站点字幕语料回归集（fixtures）
- ⬜ YouTube 音频解流签名（解开后无字幕也能转写）
- ⬜ 更多站点：西瓜 / 腾讯视频 / 微博视频 / Vimeo
- ⬜ ASS / LRC 导出、双语对照导出

欢迎在 [Issues](https://github.com/huanweide/bili-subtitle-universal/issues) 里说你最想要哪一个。

---

## 贡献 / Contributing

1. Fork → 建分支 → 改代码
2. 跑测试电池（`node tests/run-tests.js` 等，见[命令速查](#命令速查--command-reference)）
3. bump `@version` 时**连 README 版本徽章 + CHANGELOG 一起改**（`check-docs.js` 会卡漂移）
4. push 后**必跑** `node scripts/cdn-refresh.js`——jsDelivr 对 `@main` 有 12 小时缓存，不刷新用户拿到的还是旧版

新增对外宣传的功能时，请在 `tests/test-claims.js` 里补一条证据断言：**README 承诺的每一条都要能在源码里指到一行。**

---

## License

MIT — 详见 [LICENSE](LICENSE)。B 站、YouTube 等名称为其各自所有者的商标。

---

## Star

如果这个脚本帮你省下了一次手打字幕的时间，**点个 Star 就是最好的回报**——它也是更多人找到这个项目的唯一方式。

**作者**：huanweide（[@huanweide](https://github.com/huanweide)）· MIT · © 2026

**同一作者的其他工具**（顺手点个 Star ⭐）：

- 🐍 [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) · B 站字幕 Python 命令行版（批量 / 可脚本化）
- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · 直播 / 会议实时中文字幕（本地识别）
- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · 智慧树网课自动播放 / 断点续播
- ✂️ [video-brief](https://github.com/huanweide/video-brief) · 视频内容速览
- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · 代码健康工具总览
- 📦 [全部仓库](https://github.com/huanweide?tab=repositories)
