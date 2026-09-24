# CHANGELOG

## 9.0.0 · 分段解码上线：3 小时长音频不再需要播放，内存恒定

**这是从「能用」到「好用」的一次架构升级。**

v8.2 把解码内存降下来了，但立体声大文件仍只能走「静音播放录制」——要真播十几分钟。v9.0 换掉整条音频管线：**不播放、不整段解码，按分片目录逐片取、逐片解。**

原理（大白话）：B 站音频是分片 MP4，结构固定——

```
ftyp + moov + sidx + [ moof + mdat ] × N
 └──── init 说明书 ────┘   └── 一片片媒体数据 ──┘
```

- 开头一小段（约 1KB）是「说明书」，写着编码参数
- `sidx` 是「分片目录」，一次读出来就有每一片的大小与时长
- 任意一片 = 说明书 + 该片数据，拼起来就能独立解码

于是流程变成：读说明书 → 按目录并发取片 → 每片单独解码成 16kHz → 攒够 2 分钟送一次识别 → 时间戳用目录给的精确起点。

| 指标 | 播放录制（v8.2） | 分段解码（v9.0） |
|---|---|---|
| 3 小时音频耗时 | 约 13 分钟（16 倍速） | 音频处理本身几十秒，总耗时取决于识别速度 |
| 内存 | 恒定（一片） | 恒定（一片，几十 KB 原始 + 一小段 PCM） |
| 声音 | 静音播放 | **完全不播放** |
| 时间戳 | 靠数样本推算，可能漂移 | 用分片目录的精确起点 |
| 页面在后台 | 需要播放，受节流影响 | 纯网络加计算，不受影响 |
| 断点续传 | 无 | 分片天然可续（v9.1 落实） |

**前置验证已跑通**（工具留在 `tests/range-probe.js`）：B 站音频 CDN 返回 `HTTP 206 Partial Content` 与 `Content-Range`，支持按字节范围请求；实测 3.55 小时视频的音频结构为 `ftyp(32) + moov(817) + sidx(232) + [moof+mdat]×N`，单片约 40KB、约 5 秒。

**安全设计**：分段路失败（没有 sidx、CDN 拒绝 Range、切视频）会自动回落到 v8.2 的整段解码 / 播放录制，一条路堵不死；设置里选「始终播放录制」时直接跳过分段路。

- **【新增】`fetchRange`**：带 Range 头的二进制下载。
- **【新增】`listBoxes` / `parseSidx`**：解析 fMP4 顶层盒子与分片目录，一次拿到全部分片的大小与时长。
- **【新增】`probeSegments`**：读文件头定位 init 段与分片表。
- **【新增】`segmentAsr`**：并发取片 → 逐片解码 → 攒 120 秒一批送识别 → 用目录起点做精确时间戳。
- **【新增】`toMono`**：立体声按左右平均混单声道，不丢内容。
- **【测试】Node 单测 75/75**（69 → 75）：新增分片目录解析、顶层盒子遍历、立体声混单声道、分段路集成与回落、Range 请求格式、批次常量断言。
- **【新增工具】`tests/range-probe.js`**：一条命令探测任意 B 站视频的音频分片结构与 Range 支持，今后排查长音频问题先用它。

## 8.2.1 · 独立审查后的 12 处修复（含 2 处高危）

v8.2.0 发布后立刻跑了一轮对抗式代码审查，逐条核实后修掉 12 个问题。两条会直接打在三小时场景上：

- **【高危】`decodeAudioData` 不会把立体声降成单声道，内存估算少算一半**：v8.2.0 按「单声道 64KB/秒」估解码占用，而 Web Audio 里 `decodeAudioData` 只按上下文采样率重采样、**不改声道数**——立体声源解出来仍是两个声道，3 小时实际约 1.38GB，估算却只有 659MB，判定「不用录制」后直接申请 1.38GB → 标签页 OOM。现在：估算按真实声道数算（单声道 64KB/s、立体声 128KB/s，未知一律按立体声保守），并新增 `probeMp4Channels()` 递归钻进 `moov > trak > mdia > minf > stbl > stsd > mp4a` 读真实声道数——单声道长音频照走解码快路，立体声超阈值走稳路。解码完成后还会按实际 `numberOfChannels` 复核一次。
- **【高危】`state.audioDurSec` 不随切视频重置**：站内切换视频后沿用上一条视频的时长——「② 读时长」永远不再触发、界面时长显示错误、选路也可能算错（先看短片再看 3 小时长片 → 按短片估内存 → 撞 OOM）。现在 `resetForNewVideo()` 一并重置时长、体积、声道。
- **【中】进度条会倒退**：直传失败转解码（45% → 34%）、解码失败转录制（34% → 22%），看着像出错。现在加单调保护，只许前进。
- **【中】胶囊与悬浮按钮重叠**：两者同坐标同层级，胶囊亮着时按钮点不到；点一次收起后 0.5 秒又被重绘恢复。现在改成二选一显示（面板展开显示按钮、面板收起显示胶囊），永不重叠。
- **【中】半截收尾会把字幕拉满整条时间轴**：录制只跑到 60% 就收尾时，旧逻辑按约 1.67 倍缩放，把已有字幕均匀铺满全片，做出「越往后越对不上」的假时间轴，还标记为完整。现在只有确实播到结尾才做对账；提前收尾改为标记不完整，界面显示「⚠️ 字幕可能不完整」。
- **【低】`audio.play()` 的 Promise 没人接**：背压恢复与兜底分支用 try/catch 包 Promise，接不住异步拒绝，恢复实际失败还会报 unhandledrejection。现在统一 `.catch()`，并把背压复位抽成 `maybeResume()`，在小切片 `continue` 之前也调用（堵住潜伏死锁）。
- **【低】回退到 `captureStream` 的分支没静音**：那条路元素的输出没被 Web Audio 接管，图内增益 0 管不到它，会外放倍速怪声。现在显式设 `audio.volume = 0`。
- **【低】AudioWorklet 收尾丢掉最后一个未满缓冲**：最多丢结尾 0.34 秒。现在收尾发 `{flush:true}`，worklet 把剩余样本冲出来。
- **【低】AudioWorklet 加载失败时 Blob URL 泄漏**：改为 `finally` 里回收。
- **【低·老问题】MIME 自愈是死代码**：`decodeAudioData` 会 detach 传进去的 ArrayBuffer，旧代码在空壳上探测魔数、又把重试结果丢给同一个空壳，等于没重试。现在先留存头字节，重试时重新从 blob 读一份。
- **【审查确认无问题】** AudioWorklet 与 ScriptProcessor 回退分支互斥、worklet 节点接入活路径、静音节点不影响播放推进与采数、`probeAudioMeta` 全路径释放 Blob URL、五阶段 `stage` 全路径赋值、12 个 DOM id 一一对应。
- **【测试】Node 单测 69/69**（54 → 69，新增 15 条）：声道估算三分支（单声道 / 立体声 / 未知）、MP4 声道解析（手工构造最小 MP4 盒子）、切视频重置、进度单调保护、对账条件收紧、不完整标记传递、ctx.resume、背压复位、回退静音、worklet flush 与 Blob 回收、MIME 自愈真重试。

## 8.2.0 · 3 小时长音频破局：解码省 5.5 倍内存 + 全程静音 + 五阶段进度

- **【核心·破局】解码目标改成 16000 单声道，长音频不再被迫走「播放录制」**：旧版用 `new OfflineAudioContext(1, 2, 44100)` 解码，3 小时音频解出约 3.8GB PCM，内存必爆，于是超过 40MB 的源文件统统被推去「播放录制」（要真放 13 分钟，还带噪音）。改成 `new Ctx(1, 1, 16000)` 后同样内容只占约 659MB（省 5.5 倍），3 小时音频落回「直接解码切片」的快路，几十秒出结果。**这是「60 分钟能用、3 小时不行」的正解。**
- **【核心】选路不再靠猜，改读音频真实时长**：新增 `probeAudioMeta()`——借隐藏 audio 元素 `preload=metadata` + `muted` 只读元数据，不出声、不下载。旧版拿「文件体积 ÷ 猜的码率」反推时长，同一份 86MB 可能是 64kbps 的 3 小时、也可能是 192kbps 的 1 小时，选错路就崩。新版先探测真实时长再算内存占用；`shouldUseRecord(blob, realDurSec)` 阈值从「解码后 1GB」调为「800MB」，另加「源文件 ≥300MB」硬保险。
- **【体验·用户第一号抱怨】转写全程静音，不再有倍速怪声**：改用 `createMediaElementSource` 接管音频输出，末端接增益 0 的节点再连 `destination`——播放位置照常推进、数据照常抓取，扬声器一声不出。
- **【稳定】抓音通道换成 AudioWorklet，主线程卡顿不再丢帧**：旧版用已被标准淘汰的 `ScriptProcessorNode`（跑主线程，页面一卡就丢一段采样，3 小时累积几十次空洞，字幕跟着乱）。新版优先加载 AudioWorklet（音频独立线程），处理器源码内联成字符串用 Blob 加载，**保持单文件油猴脚本形态，不额外分发文件**；不支持的环境自动退回 ScriptProcessor。
- **【稳定】停滞判定不再「5 秒不动就收工」**：旧版只认播放位置 5 秒（20 次 × 250ms）不动就判播放结束，3 小时音频一次缓冲抖动就被提前截断（**3H 只转出开头一截的主因之一**）。新版同时看播放位置与 `audio.buffered` 末尾：位置在动、或缓冲还在往前长 / 还没缓冲够，都算「在推进」；位置与缓冲同时停住 20 秒（80 次 × 250ms）才收尾。
- **【稳定】新增背压闸门**：待转写切片积压 ≥3 片就暂停播放，等转写消费者追上来再续播，长音频内存不再一路上涨；背压暂停不会被「意外暂停自动恢复」逻辑打断。
- **【体验】五阶段进度 + 实时字幕流 + 胶囊小条 + 完成通知**：
  - 总进度按阶段权重折算成一条：下载 0-20 / 读时长 20-22 / 解码或录制 22-45 / 转写 45-95 / 合并 95-100，配五格阶段指示条（走过的打勾、当前的加亮）。
  - 实时数字：音频体积、时长、已处理到哪、已用时间、**预计还需多久**（按实测速度外推，随时修正）。
  - **实时字幕流**：转写过程中把最近 40 句挂在界面上，边转边长，看得见进展。
  - **胶囊小条**：面板收起后显示「🎧 62% · 约 8 分钟」，不挡视频，点一下展开。
  - **完成通知**：转完发系统通知（`@grant GM_notification`），可以放心切走干别的。
- **【测试】Node 单测 54/54 全绿**（原 41 + 新增 13 条 v8.2.0 回归）：解码采样率断言、probeAudioMeta 静音断言、静音增益 0 断言、AudioWorklet 内联与回退断言、停滞阈值收紧断言、背压闸门断言、五阶段 stage 断言、实时预览断言、完成通知断言、总进度权重断言；选路断言按新公式重写（3H 有真实时长 → 走解码快路，无真实时长 → 保守估仍 < 800MB 走解码，10 小时 → 走录制）。

## 8.1.8 · 多 P 视频切 P 字幕不刷新修复

- **【修复·主犯】字幕缓存 key 没带 cid，多 P 必串台**：`fetchBody` 的缓存 key 是 `bvid_lan`，而 B站多 P 视频所有分 P 共用同一个 bvid——P1 和 P2 撞同一个缓存 key，切 P 后点「获取字幕」永远直接命中上一 P 的缓存字幕，怎么点都不更新。改为 **`cid_lan`（B站 cid 全站唯一）优先**、YouTube `videoId` 次之，多 P 各 P 各自缓存互不干扰。
- **【修复·帮凶】getSubtitles 全程无世代号守卫**：上一 P 的获取流程还在途中（WBI 签名/pagelist/字幕下载多个 await）时切了 P，`resetForNewVideo` 清掉旧状态、标题刷成新 P，但旧流程会继续把上一 P 字幕写回 `state.body`——「标题是 P2、复制出来是 P1 字幕」的典型现场。函数入口捕获 `myGen = asrGen`，resolve / fetchSubs / fetchBody / translateBody / catch 五处 await 后自查 `asrStop(myGen)`，过期一律静默丢弃不写回。至此与 runAsr / switchLan / bilibili resolve（v8.1.3~8.1.4）同款病根全量封死。
- **【测试】Node 单测 41/41**（原 37 + 新增 4 条多 P 回归断言）：fetchBody 缓存 key 以 cid 优先、getSubtitles 捕获 myGen、asrStop 守卫 ≥4 处、守卫触发直接 return。浏览器灰度 17/17、状态机 7/7 零回归（Edge 无头通道 `tests/_edge-gray.js`，agent-browser 的 Chrome 本轮起不来时的备用门禁）。
- 切 P 后仍需点一次「获取字幕」（AI 转写按 P 全量收费，不做自动重转，防止 3H 多 P 视频连环烧额度）；但保证点出来的**必定是当前 P** 的字幕。

## 8.1.7 · 3H 超长音频边界修固 + 自动更新元数据

- **【修复】estimateDecodedMB 理论隐患**：旧实现 `probeMime(null)` 永远返 null（`new Uint8Array(null, ...)` 抛错被吞），导致 `bytesPerSec` 永远 12000。改成基于 `blob.type` 真实判定：webm/ogg 取 8000、mpeg 取 16000、**m4a/aac/未知取 8000 保守码率**，防 128-192kbps 高码率 3H 长视频漏判 `record` 兜底（漏判会走 decode → 浏览器 OOM）。
- **【修复】shouldUseRecord 临界 1 字节漏判**：源文件 >120MB 改 ≥120MB（严格临界用 `>=`），防 120MB 整边界走到 decode 路径。
- **【新增】自动更新元数据**：脚本头部补 `@updateURL / @downloadURL`（jsdelivr CDN `cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@main/bili-subtitle.user.js`，国内可读）+ `@supportURL`（GitHub issues 页）。Tampermonkey 现可自动检查更新，用户免手动重装——这是 v8.1.6 推广版最大盲点（你装机脚本后我推新版你不会收到提示）。
- **【测试】Node 单测 37/37**（原 32 + 新增 5 条 3H 边界）：3.55H m4a 128kbps (~195MB) auto 走录制、3H m4a 64kbps (~86MB) auto 走录制（防高码率漏判）、临界 120MB m4a auto 走录制、10MB m4a auto 不走录制、estimateDecodedMB 195MB m4a 估时长远超 3.55H（保守防漏判）。浏览器灰度 17/17、状态机 7/7 零回归。

## 8.1.6 · 硅基流动邀请码卡片 + ReTri 作者水印 + 邀请链接引导注册

- **【新增】设置面板「邀请码卡片」**：API Key 输入框下方新增橘色虚线卡片，文案「用 GitHub 注册『硅基流动』送 ¥16 代金券，跑 AI 转写完全够用」，配 **axOmWfWi 邀请码一键复制按钮**（点击弹 toast「邀请码已复制：axOmWfWi」）+ 「去注册领 ¥16 →」跳转链接 `https://cloud.siliconflow.cn/i/axOmWfWi`。已 curl 验证链接 307 重定向可达。
- **【新增】模型选择处邀请提示**：转写模型下拉下方一行小字「由『硅基流动』驱动 · GitHub 注册送 ¥16 代金券（邀请码 axOmWfWi）」，邀请码可点跳转注册页。新用户跑 AI 转写前最常看的位置露出引导。
- **【新增】作者水印 + GitHub star 引导**：面板底部常驻水印 `ReTri 出品 · 开源免费 · GitHub ⭐ 好用点个 Star`，链接仓库 `https://github.com/huanweide/bili-subtitle-universal`。`@author` 元数据同步从「阿梓 (AI 增强版)」改为 `ReTri`，统一品牌。`.bsr-b` 同步加 `flex:1;min-height:0` 让 footer 在长设置滚动时固定可见。
- **【测试】门禁三连全绿**：Node 单测 32/32、浏览器灰度 17/17、状态机模拟 7/7。**新增 UI DOM 断言**：邀请码按钮/水印/model-note 三个元素均渲染正确，邀请码点击复制 toast 文案精确「邀请码已复制：axOmWfWi」。截图 `tests/screenshot-v816-invite.png` + `screenshot-v816-card2.png` 留档。
- **【真站验证】3.55H 无字幕视频识别**：`BV1424U6JEGL`（Angelic Lofi ASMR · 3小时无循环）实站 v2 API 返回 `subCount=0, duration=12805s`——脚本「无字幕 → AI 转写兜底」触发条件正确。完整 3H AI 转写需在用户真机 + Tampermonkey + 已填 SF key 环境跑（沙箱无 key 无油猴注入），见 README「真机跑通 3H 无字幕测试的最短步骤」。

## 8.1.5 · YouTube 字幕时间戳解析修复 + 导出 TXT/SRT 加 BOM

- **【修复】parseTtml 只认 `<text start/dur>` 形态，YouTube 字幕时间戳全乱**：YouTube timedtext（`fmt=ttml`）实际返回的是 `<p begin="00:00:01.500" end="00:00:04.000">`（HH:MM:SS.mmm 属性格式），旧解析器用 `parseFloat("00:00:07.340")` 在冒号处截断得 0——时间戳全部错乱或解析为空。重写为**正则解析 + 双形态兼容**（`<text start/dur>` 秒数与 `<p begin/end>` 双时间格式），并彻底摆脱 DOMParser（Node 单测从此能真实断言解析结果）。新增 `ttmlTime` helper。
- **【修复】vttTime 不认 SRT 逗号毫秒**：`parseFloat("01,000")` 截断返回 1，SRT 型 `<track>`（部分站点 track 指向 .srt 文件）时间精度丢失到秒。三处 parseFloat 统一先 `replace(',', '.')`，VTT 点毫秒与 SRT 逗号毫秒全兼容。
- **【修复】导出 TXT/SRT 无 UTF-8 BOM，Windows 记事本打开中文乱码**：两个下载调用点内容加 `\uFEFF` 前缀（复制功能不受影响——复制走 bodyToTxt 不带 BOM）。
- **【测试】Node 单测 32/32 全绿**：新增 vttTime 逗号毫秒 / parseTtml text 形态 / parseTtml YouTube `<p>` 形态（含实体解码与 `<br>` 分行）/ ttmlTime 双格式真实断言（旧 parseTtml 用例原因依赖 DOMParser 只能验证函数存在，现为正则版可真实测）。原 17 项浏览器灰度零回归，状态机模拟 7/7 PASS。截图 `tests/screenshot-sim-v815.png` 留档。

## 8.1.4 · 设置漏存修复 + switchLan/bilibili resolve 补世代号守卫

- **【修复】v8.1 新增的两个设置字段刷新即丢**：`asrLongMode`（超长视频策略）与 `asrPlayRate`（播放录制倍速）只有 `GM_setValue` 保存、`SETTINGS` 初始化却从没 `GM_getValue` 读回——用户改完设置刷新页面就全部重置回默认值。现在初始化读回，配置真正持久化。
- **【修复】switchLan 缺世代号守卫（v8.1.3 同款病根的漏网）**：切换翻译语言是异步链路，中途 SPA 切换视频后，旧翻译返回会写回新视频的 `state.body` + 覆盖 `state.lan`。函数首捕获 `myGen = asrGen`，翻译写回前自查 `asrStop(myGen)`——过期则静默丢弃，只写 UI 不加锁。
- **【修复】bilibili resolve 异步返回污染（SPA 追尾最后一处）**：bilibili resolve 内含 2 个 `await gx`（pagelist + view API），旧 resolve 异步返回会把旧视频的 title/cid/pageTitle 塞进已重置的新 state。现在函数首捕获 `myGen`，两处 `await gx` 返回后先查 staleness（`myGen !== asrGen` 直接短路跳过写入）；从 `window.__INITIAL_STATE__` 取的同步数据也被包裹在同一守卫内。youtube 已在 v8.1.3 修过，html5 是同步 resolve 无风险——至此三个适配器的 SPA 污染源全部封死。
- **【测试】**：原 17 项灰度 17/17 零回归；状态机模拟（含 SPA stale 路径）7/7 PASS；Node 单测 29/29 全绿。截图 `tests/screenshot-sim-v814.png` 留档。

## 8.1.3 · SPA 切视频不再被旧 ASR 任务污染 + 翻译失败时 UI 不残留

- **【修复】SPA 切换视频后旧转写"追尾"覆盖新视频**：B 站/YouTube 在不刷新页面的情况下切换视频（路由变了），旧 ASR 任务可能还在网络转写、转完会跑回 `state.body` + `cache[ck]`，把上一个视频的结果当成新视频的字幕——你切到新视频看到的还是老字幕。引入 `asrGen` 世代号机制：每次 `resetForNewVideo()` 触发就 `asrGen++`，所有旧任务每个取消/等待/循环点自查 `asrStop(myGen)`（= myGen !== asrGen 或用户取消）——过期则立刻脱身、丢弃旧结果、不调用 `finishAsr()`（避免清掉新任务的 UI）。21 个旧式 `state.asr && state.asr.cancel` 检查点全部改造为 `asrStop(myGen)`。
- **【修复】字幕主流程翻译 `state.asr` 残留**：之前 `try` 失败回落到「读不到翻译 → 不当作错误」分支时 `state.asr` 没清，导致按钮一直转圈、UI 显示「转写中」却再无动作。现在失败分支统一清状态、出 toast。
- **【修复】B 站 SPA 字幕张冠李戴**：`getSubtitles` 之前从不先清空 `state.subs`，切换视频后会用旧列表去拉新视频的字幕 → **拉回来的还是上个视频的内容**。`resolve()` 阶段先按适配器类型重置 `state.subs = []`。
- **【修复】YouTube 嵌入页 `match` 漏域**：embed 常用 `youtube-nocookie.com` 之前识别不到。`resolve()` 现在以地址栏 `?v=` 为准覆盖 SPA 陈旧的 `videoDetails.videoId`，并清空过时字幕轨道。
- **【测试】状态机模拟新增 SPA stale 路径**（`tests/recorder-sim.html`）：用 `bumpGen()` 模拟 `asrGen++`，验证旧 `recorderAsr` 在切视频场景下能静默丢弃、快速脱身。**7/7 PASS**（原 6 条 + 新 stale）。原 17 项灰度零回归，Node 单测 29/29 全绿。
- **【底层】state 代理活引用**：`recorder-sim.html` 的 depCode 改为 Proxy，每次读写实时指向 `window.__simState`，保证用例中途改 `cancel` 立即生效。

## 8.1.2 · 取消「保留已转写内容」落到实处 + 播放录制状态机模拟器

- **【修复】取消是假保留**：分片/录制转写中途点「✖ 取消」时，界面提示「已取消（保留已转写内容）」，但已转好的片段只存在局部变量、没写回界面与缓存——用户取消后实际什么都看不到。现在取消时把已转片段合并写回 `state.body` + 缓存（标注 `ASR·取消`），toast 明确「已取消（保留已转写 N 句）」。
- **【新增】recorderAsr 状态机模拟器** `tests/recorder-sim.html`：真实 Chromium 里 mock Web Audio / Audio / captureStream / 转写接口，驱动 6 条路径——自然结束 / 中途取消 / 意外暂停自动恢复 / 停滞 5s 收尾 / 解锁成功放行 / 解锁取消立即脱身。**任何一条卡死即 FAIL**，把 v8.1.1 修的四个竞态固化成永久防回归门。
- **测试**：状态机模拟 6/6 PASS（真实 Chromium）；原灰度 17/17 PASS 零回归；Node 单测 29/29 全绿。

## 8.1.1 · 修复播放录制兜底通道的取消/暂停竞态

- **【重大修复】解锁死锁**：浏览器拦截自动播放后，点「▶ 解锁播放并继续」成功时只改了 UI、**从未放行等待中的 Promise**，转写会永久挂起、且此阶段点取消也无人响应。现在解锁成功即放行；解锁等待期每 200ms 监听取消，两条路都不再死锁。
- **【重大修复】播放期永久挂起**：主等待只认 `onended`/`cancel`，若浏览器音频策略意外暂停、或播放停滞（缓冲卡住），永远收不了尾。现在三重兜底：意外暂停自动 `play()` 恢复一次；`currentTime` 连续 5 秒不推进按自然结束收尾；到达 `totalDur` 直接收尾。
- **【修复】取消后脏转写**：`cancel` 置位瞬间若有切片正在网络转写，其文本仍会被解析混入 `segsAll` 并刷新 UI（覆盖取消后的清理）。现在网络返回后、拆半子转写内都复查取消，取消的切片一律丢弃、不渲染。
- **【修复】消费者异常静默吞半截**：转写中途网络/接口失败只打日志，主流程把半截结果当成功返回、用户无感知。现在真实失败原因上抛，非取消场景 toast「⚠ 播放录制中途出错，已保留成功转写部分」。
- 顺手清理：`stopRecorder` 移除 `onpause` 残留监听。
- **测试**：浏览器灰度 17/17 PASS（零回归），Node 单测 29/29 全绿。

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