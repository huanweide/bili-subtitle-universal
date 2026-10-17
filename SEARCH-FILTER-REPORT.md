# SEARCH-FILTER-REPORT · v9.1 搜索筛选 / 评分 / 转写质量 收尾报告

日期：2026-10-17 · 工作目录：`gh-optimizer/bili-subtitle-universal`

## 一、总体结论

昨夜写的三个模块逻辑基本成立，但有 **5 处真实 bug** 和 **1 个构建不同步问题**，已全部修复；文档、测试、版本号已补齐。**模块层可交付，UI 接线未做**（见第六节，这是最重要的未决项）。

## 二、发现并修复的问题

### 模块 bug（5 处，均已修并注释「为什么」）

| # | 文件 | 问题 | 修法 |
|---|---|---|---|
| 1 | `candidate-scorer.js` `normalizeWeights` | 设置面板清空某项时存入 `null`，而 `Number(null)===0` 能通过 `isFinite` 检查，把「用户没配」静默变成「配了 0 分」，信号被关掉 | 显式把 `null / undefined / ''` 当未配置，回退默认权重 |
| 2 | `search-filter.js` `normalizeBilibili` | `!!item.hasNativeSubtitle` 遇到字符串 `'false'` 得到 `true`，「确定无字幕」被误判成「有字幕」，评分引擎不再重罚 ASR 成本 | 抽 `coerceSubtitleFlag()`，`'false'`→`false`、`'true'`→`true`、缺省→`null` |
| 3 | `search-filter.js` 字幕探测循环 | `like / coin / favorite` 三个字段漏写 `|| candidate.x` 兜底（相邻的 play/danmaku 都有），view 接口不返回时会把搜索结果里的有效值清零，收藏比失真 | 与相邻字段对齐补兜底 |
| 4 | `search-filter.js` `randomDelayMs` | 注入的 `random` 返回 `NaN` 时延迟变 `NaN`，`sleep(NaN)` 立即返回，800–1500ms 节流形同虚设，反而更容易触发 412 | 非有限值回落中值 0.5 |
| 5 | `transcript-quality.js` `polishBody` | 40 字上限只在追加**后**检查，单条 5 字碎片能把 35 字的句子顶到 43 字（测试实测冲出），且句尾连续标点（`，；`）只剥一个会留 `，。` 残迹 | 追加**前**预判越界即断句（当前已 ≥15 字时）；句间标点用 `+` 全剥 |

### 构建不同步（1 处）

`build.js` 声明内联 3 个模块，但主脚本 `build:modules` 区只有 2 个——**`transcript-quality.js` 从未进过单文件**。已执行 `node build.js` 同步（现为主脚本 +676 行的组成部分）。今后改模块后必须重跑 `node build.js`。

## 三、版本 bump

- `bili-subtitle.user.js`：`@version 9.0.0 → 9.1.0`，`@description` 补充 v9.1 能力摘要，metadata 块后新增版本历史注释（9.1.0 / 9.0.0 / 8.2.1 三条）。

## 四、测试

新建 `tests/test-scorer.js`（纯 Node、无框架、`node tests/test-scorer.js` 直接跑，失败退出码 1）：

- **评分引擎**：知识类教程（有字幕/20 分钟/知识分区/标题知识词/高收藏比）→ A 档满分 100；娱乐视频（reaction/挑战/翻唱 + 无字幕 + 过短）→ C 档 −92；无字幕同分内容权重和差 80、−38 为最大单条权重；字幕未知（null）只轻罚不误杀；边界（null item、空对象、空标题、500 字标题、时长为 0/负/NaN/字符串）不崩；可解释性（每条理由带 signal/weight/detail）；权重可配（含 null 回退、±100 截断、数字字符串）。
- **搜索纯函数**：parseCount（万/亿/逗号/脏值）、两种时长格式、`'false'` 字幕标记回归、filterCandidates 六种筛选、randomDelayMs 范围与 NaN 防护。
- **转写质量**：相邻重复去重四型（精确重复/部分重叠/包含/空行）、2 秒碎片 → 40+20 两句（15–40 字）、疑问补问号与短句合并、章节锚点 `[mm:ss]` 与 180–300 秒截断、热词来自视频自身元数据、LLM 纠错响应接受/拒绝（条目数、顺序、空内容、非 JSON、伪变更过滤）。

结果：**19/19 通过，退出码 0**；旧套件 `tests/run-tests.js` **75/75 回归通过**（确认 build 同步未破坏主脚本）。

## 五、文档

- **CHANGELOG.md**：顶部新增 9.1.0 节（搜索 Tab / 可解释评分 / 三层质量表 / 双形态导出 / ASR 退避重试 / 已知限制四条）。
- **README.md**：版本徽章 → 9.1.0；Star 理由表加 2 行；「四、导出」改双形态；新增「五、搜索筛选」（用法 + 完整 11 项权重表 + A/B/C 档位含义 + 已知限制）与「六、转写质量提升」（三层对比表 + 热词为何来自自身元数据 + 为何先修再补）；设置项表加 3 行；FAQ 加 2 条；路线图更新（v9.1 标记完成，断点续传移至 v9.2）；开发命令补 `test-scorer.js` 与 `build.js`。

## 六、没做到的部分（必读）

1. **面板 UI 接线未做**。昨夜 476 行 diff 经核实全部是模块内联；主脚本里 `CandidateScorer / SearchFilter / TranscriptQuality` 三个实例已生成但**没有任何调用方**——搜索 Tab 的 DOM 与交互、`SETTINGS` 新键（YouTube Key / 评分权重 / 质量开关）、导出按钮接入、ASR 退避重试与失败进度上报，都还没有接进主流程。CHANGELOG / README 按 9.1 功能形态撰写，用户实际使用需等这层接线（工作量主要集中在面板渲染与 settings 持久化，模块 API 已就绪：`scoreCandidate(item, weights)` / `searchBilibili(kw, opts, deps)` / `searchYouTube(kw, opts, deps)` / `polishBody` / `bodyToAiText` / `bodyToAnchoredText` / `buildHotwords`）。
2. **`tests/run-tests.js` 未合并新套件**：`test-scorer.js` 独立运行（19 项），未并入 75 项主套件，避免改动既有 CI 入口。
3. **未做浏览器真机验证**：wbi 搜索、player/v2 探测、YouTube 搜索均需真实网络与登录态，Node 环境只能覆盖纯函数与 mock 依赖路径。
4. **未 git commit / push**（按要求由你统一处理）。

## 七、验证清单（收尾状态）

- [x] `node --check bili-subtitle.user.js` 通过
- [x] `node --check modules/*.js` 三个全部通过
- [x] `node tests/test-scorer.js` → 19/19，退出码 0
- [x] `node tests/run-tests.js` → 75/75 回归通过
- [x] `node build.js` 已同步 3 模块（修模块后重跑过两次）
- [x] 密钥扫描：`sk-[A-Za-z0-9]{16,}` / `Bearer <真实值>` / `AIza...` 均无匹配（README 中 `sk-...` 为占位符示例）
- [x] 未执行任何 git 写操作
