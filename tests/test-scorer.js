'use strict';

/**
 * tests/test-scorer.js — v9.1 新增模块的纯 Node 单元测试（无测试框架）
 *
 * 怎么跑：
 *   node tests/test-scorer.js
 *
 * 预期输出：
 *   逐条打印 [PASS] <用例名>，结尾打印汇总：
 *     PASS <n>/<n>  （全部通过）
 *   任一断言失败立即打印 [FAIL] <用例名> — <期望> — <实际> 并以退出码 1 结束。
 *   成功退出码为 0。
 *
 * 覆盖范围：
 *   A. CandidateScorer 评分引擎：知识类 A 档 / 娱乐 C 档 / 无字幕重罚（最高权重信号）/
 *      空标题·null 字段·超长标题·时长为 0 或负不崩 / 可解释性（reasons 结构）/
 *      权重可配（含 null 回退与 ±100 截断）/ 滑块标签表与范围（v9.3）
 *   B. SearchFilter 纯函数：parseCount / parseBiliDuration / parseIsoDuration /
 *      normalizeBilibili（含 'false' 字符串字幕标记纠错）/ filterCandidates / randomDelayMs
 *   C. TranscriptQuality：相邻重复行去重（精确重复 / 部分重叠 / 包含 / 空行）/
 *      断句合并（2 秒碎片 → 15–40 字自然句）/ 章节锚点稿 / 热词来自视频自身元数据 /
 *      LLM 纠错响应的接受与拒绝
 *  D. SegResume 断点续传状态层：读写往返 / 换视频即失效 / 24h TTL 与时钟回拨 /
 *      脏数据消毒 / 清断点 / 超限不写
 */

var CandidateScorer = require('../modules/candidate-scorer.js');
var SearchFilter = require('../modules/search-filter.js');
var TranscriptQuality = require('../modules/transcript-quality.js');
var SegResume = require('../modules/seg-resume.js');

// ---------- 迷你断言框架 ----------
var passed = 0, failed = 0, current = '';

function test(name, fn) {
  current = name;
  try {
    fn();
    passed++;
    console.log('[PASS] ' + name);
  } catch (error) {
    failed++;
    console.log('[FAIL] ' + name + ' — ' + error.message);
  }
}

function ok(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || '值不符') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

function deepEq(actual, expected, what) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((what || '对象不符') + '：期望 ' + e + '，实际 ' + a);
}

function throws(fn, what) {
  var threw = false;
  try { fn(); } catch (error) { threw = true; }
  ok(threw, what || '应当抛错但没有抛');
}

function notThrows(fn, what) {
  try { fn(); } catch (error) {
    throw new Error((what || '不应抛错') + '：抛出了 ' + error.message);
  }
}

function plainLen(text) {
  return String(text || '').replace(/[\s，。！？；：,.!?;:…]/g, '').length;
}

// ============================================================
// A. CandidateScorer 评分引擎
// ============================================================

var KNOWLEDGE_ITEM = {
  hasNativeSubtitle: true,
  durationSec: 1200,                 // 20 分钟，落在 8–60 分钟理想区间
  typename: '计算机技术',
  title: 'Python从零入门教程：保姆级讲解',
  like: 1000, favorite: 500, coin: 300 // 收藏/点赞=0.5，投币/点赞=0.3
};

test('A1 知识类教程视频 → tier A 且总分高', function () {
  var r = CandidateScorer.scoreCandidate(KNOWLEDGE_ITEM);
  eq(r.tier, 'A', '知识教程视频档位');
  ok(r.total >= 55, '总分应 ≥55（A 档线），实际 ' + r.total);
  // 42(字幕)+14(时长)+16(分区)+18(标题)+14(收藏)+10(投币)=114，截断到 100
  eq(r.total, 100, '满分截断后的总分');
  eq(r.reasons.length, 6, '应命中 6 条加分信号');
});

test('A2 娱乐视频（reaction/挑战/翻唱）→ tier C 且低分', function () {
  var r = CandidateScorer.scoreCandidate({
    hasNativeSubtitle: false,
    durationSec: 95,                  // 不足 3 分钟
    typename: '娱乐',
    title: '【挑战】凌晨三点 reaction 翻唱整活现场',
    like: 100, favorite: 1            // 收藏比 0.01，低于加分阈值
  });
  eq(r.tier, 'C', '娱乐视频档位');
  ok(r.total < 25, '总分应 <25（B 档线），实际 ' + r.total);
  // -38(无字幕)-18(过短)-36(排除词) = -92
  eq(r.total, -92, '惩罚叠加后的总分');
});

test('A3 无字幕是最高权重信号：同分内容有无字幕分差 ≥70，且 -38 是最大单条权重', function () {
  var withSub = CandidateScorer.scoreCandidate(KNOWLEDGE_ITEM);
  var noSub = CandidateScorer.scoreCandidate(Object.assign({}, KNOWLEDGE_ITEM, { hasNativeSubtitle: false }));
  function sumWeights(r) {
    return r.reasons.reduce(function (s, x) { return s + x.weight; }, 0);
  }
  // 截断前权重和：114 vs 34，差 80（42 与 -38 的全部距离）
  eq(sumWeights(withSub) - sumWeights(noSub), 80, '有无字幕的权重和差');
  // 截断后：100 vs 34（withSub 被 100 上限截掉 14 分）
  ok(withSub.total - noSub.total >= 60,
    '有无字幕分差应 ≥60（截断后仍有 66），实际 ' + (withSub.total - noSub.total));
  ok(noSub.total < 55, '无字幕即使内容优秀也不该进 A 档，实际 ' + noSub.total);
  var noSubReason = noSub.reasons.filter(function (x) { return x.signal === 'noNativeSubtitle'; })[0];
  ok(noSubReason, '应产出 noNativeSubtitle 理由');
  eq(noSubReason.weight, -38, '默认无字幕权重');
  var maxOther = noSub.reasons
    .filter(function (x) { return x.signal !== 'noNativeSubtitle'; })
    .reduce(function (m, x) { return Math.max(m, Math.abs(x.weight)); }, 0);
  ok(Math.abs(noSubReason.weight) >= maxOther,
    '无字幕惩罚应是最大单条权重，实际 ' + Math.abs(noSubReason.weight) + ' vs ' + maxOther);
});

test('A3b 字幕探测失败（null）只轻罚，不误杀优秀候选', function () {
  var r = CandidateScorer.scoreCandidate(Object.assign({}, KNOWLEDGE_ITEM, { hasNativeSubtitle: null }));
  // 42(有字幕) 换成 -8(未知)：114 - 42 - 8 = 64
  eq(r.total, 64, '未知只轻罚：114-42-8=64');
  ok(r.tier === 'A', '探测失败不应直接把优秀候选打到 B/C，实际 ' + r.tier);
});

test('A4 边界输入不崩：null / 空对象 / 空标题 / 超长标题 / 时长为 0 或负 / 脏数据', function () {
  notThrows(function () { CandidateScorer.scoreCandidate(null); }, 'null item');
  notThrows(function () { CandidateScorer.scoreCandidate({}); }, '空对象');
  notThrows(function () {
    CandidateScorer.scoreCandidate({ title: null, typename: undefined, like: null, favorite: 'x', durationSec: 'abc' });
  }, 'null/脏字段');
  notThrows(function () {
    CandidateScorer.scoreCandidate({ title: 'x'.repeat(500), durationSec: 0 });
  }, '超长标题 + 时长为 0');
  notThrows(function () {
    CandidateScorer.scoreCandidate({ title: '教程', durationSec: -999 });
  }, '负时长');
  notThrows(function () {
    CandidateScorer.scoreCandidate({ title: '教程', durationSec: NaN, hasNativeSubtitle: 'maybe' });
  }, 'NaN 时长 + 未知字幕字符串');
  var r = CandidateScorer.scoreCandidate({ title: '教程', durationSec: -999 });
  eq(r.tier, 'C', '负时长视频至多少个信号都不该崩且档位合法');
  ok(r.reasons.every(function (x) { return typeof x.weight === 'number' && isFinite(x.weight); }),
    '边界场景的理由权重必须是有限数');
  var r2 = CandidateScorer.scoreCandidate({ title: '教程', durationSec: '1200' });
  eq(r2.total, 24, '字符串时长 "1200" 应被正确转换：-8(字幕未知)+18(标题)+14(时长)');
});

test('A5 可解释性：每条分数都带 signal/weight/detail，且 detail 非空', function () {
  var r = CandidateScorer.scoreCandidate(KNOWLEDGE_ITEM);
  ok(r.reasons.length > 0, '至少应有一条理由');
  r.reasons.forEach(function (reason, i) {
    ok(typeof reason.signal === 'string' && reason.signal.length > 0, '第 ' + i + ' 条缺 signal');
    ok(typeof reason.weight === 'number' && isFinite(reason.weight), '第 ' + i + ' 条 weight 非有限数');
    ok(typeof reason.detail === 'string' && reason.detail.length > 0, '第 ' + i + ' 条缺 detail');
  });
  var r2 = CandidateScorer.scoreCandidate({
    hasNativeSubtitle: true, durationSec: 1200, typename: '知识',
    title: '从零入门', like: 10, favorite: 5, coin: 2
  });
  var fav = r2.reasons.filter(function (x) { return x.signal === 'favoriteLikeRatio'; })[0];
  ok(fav && fav.detail.indexOf('收藏/点赞=') === 0, '收藏比理由应带可读数值明细');
});

test('A6 权重可配：改权重对象后分数跟着变；null/空串/越界都有定义', function () {
  var base = CandidateScorer.scoreCandidate(KNOWLEDGE_ITEM);
  var noSubBonus = CandidateScorer.scoreCandidate(KNOWLEDGE_ITEM, { nativeSubtitle: -100 });
  ok(noSubBonus.total < base.total, '把字幕加分改成 -100 后总分必须下降');
  eq(noSubBonus.tier, 'C', '字幕权重改成 -100 后应掉到 C 档');
  var boosted = CandidateScorer.scoreCandidate(KNOWLEDGE_ITEM, { durationIdeal: 100 });
  ok(boosted.total >= base.total, '加大时长权重后总分不应下降');
  eq(CandidateScorer.normalizeWeights(null).nativeSubtitle, 42, 'null 配置回退默认');
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: null }).nativeSubtitle, 42,
    'null 值按「未配置」回退默认，不能被 Number(null)=0 静默关掉');
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: '' }).nativeSubtitle, 42, '空串回退默认');
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: 'abc' }).nativeSubtitle, 42, '非数字回退默认');
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: '42' }).nativeSubtitle, 42, '数字字符串应被接受');
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: 999 }).nativeSubtitle, 100, '越界上截断到 100');
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: -999 }).nativeSubtitle, -100, '越界下截断到 -100');
  eq(CandidateScorer.DEFAULT_WEIGHTS.nativeSubtitle, 42, '默认权重表可读');
});
test('A7 WEIGHT_LABELS 与 DEFAULT_WEIGHTS 键集合一致（v9.3 滑块面板不少项）', function () {
  var dKeys = Object.keys(CandidateScorer.DEFAULT_WEIGHTS).sort();
  var lKeys = Object.keys(CandidateScorer.WEIGHT_LABELS).sort();
  deepEq(lKeys, dKeys, '标签键集合必须与默认权重键集合一致：新增权重忘加标签 = 滑块面板静默少一项');
  lKeys.forEach(function (k) {
    ok(typeof CandidateScorer.WEIGHT_LABELS[k] === 'string' && CandidateScorer.WEIGHT_LABELS[k].length > 0,
      '标签不能为空：' + k);
  });
});
test('A8 WEIGHT_RANGE 与归一化截断边界同源（滑块到头 = 截断值，不货不对板）', function () {
  var r = CandidateScorer.WEIGHT_RANGE;
  ok(r.min === -100 && r.max === 100, '范围应为 -100..100，实际 ' + r.min + '..' + r.max);
  eq(CandidateScorer.normalizeWeights({ nativeSubtitle: r.max + 500 }).nativeSubtitle, r.max,
    '超上限归一化后必须等于滑块最大值');
  eq(CandidateScorer.normalizeWeights({ noNativeSubtitle: r.min - 500 }).noNativeSubtitle, r.min,
    '超下限归一化后必须等于滑块最小值');
});

// ---------- v9.5 权重预设 ----------
// 三个代表候选，用来验证预设「真的改变了排序」，而不只是换了一组好看的数字。
var PRE_CAND = {
  // 无字幕但极干货：知识分区 + 知识标题 + 收藏投币比都拉满
  strongNoSub: {
    hasNativeSubtitle: false, durationSec: 1800, typename: '科学科普',
    title: '一文讲透傅里叶变换 从零入门', like: 1000, favorite: 500, coin: 300
  },
  // 有字幕但娱乐向：有字幕加分，但分区/标题/互动比全不占
  subButFun: {
    hasNativeSubtitle: true, durationSec: 600, typename: '音乐',
    title: '钢琴演奏 现场版', like: 1000, favorite: 50, coin: 20
  },
  // 有字幕且干货：三档都该是 A（好内容不该被预设摆布）
  subAndStrong: {
    hasNativeSubtitle: true, durationSec: 2400, typename: '计算机技术',
    title: '操作系统原理 保姆级教程', like: 2000, favorite: 900, coin: 500
  },
  // 无字幕且是直播回放：三档都该是 C（排除词必须硬生效，没有预设能把它捞进 A/B）
  liveReplay: {
    hasNativeSubtitle: false, durationSec: 5400, typename: '知识',
    title: '公开课直播回放', like: 800, favorite: 60, coin: 30
  }
};
function tierUnder(preset, item) {
  return CandidateScorer.scoreCandidate(item, CandidateScorer.getPreset(preset)).tier;
}
function totalUnder(preset, item) {
  return CandidateScorer.scoreCandidate(item, CandidateScorer.getPreset(preset)).total;
}

test('A9 每套预设的键集合与标签都与 DEFAULT_WEIGHTS 一致（v9.5 不做半套预设）', function () {
  var dKeys = Object.keys(CandidateScorer.DEFAULT_WEIGHTS).sort();
  var names = Object.keys(CandidateScorer.WEIGHT_PRESETS);
  ok(names.length >= 3, '至少三套预设，实际 ' + names.length);
  names.forEach(function (n) {
    deepEq(Object.keys(CandidateScorer.WEIGHT_PRESETS[n]).sort(), dKeys,
      '预设 ' + n + ' 缺键或多键：半套预设会让 getPreset 静默用默认值补齐，用户看不出');
    ok(typeof CandidateScorer.WEIGHT_PRESET_LABELS[n] === 'string'
      && CandidateScorer.WEIGHT_PRESET_LABELS[n].length > 0,
      '预设标签不能为空（按钮会退化成英文键名）：' + n);
  });
  deepEq(Object.keys(CandidateScorer.WEIGHT_PRESET_LABELS).sort(), names.slice().sort(),
    '预设名与预设标签必须一一对应');
});

test('A10 均衡档就是默认权重（单一事实源），getPreset 未知名回退默认', function () {
  ok(typeof CandidateScorer.DEFAULT_PRESET === 'string'
    && CandidateScorer.WEIGHT_PRESETS[CandidateScorer.DEFAULT_PRESET],
    'DEFAULT_PRESET 必须指向真实存在的预设，实际 ' + CandidateScorer.DEFAULT_PRESET);
  deepEq(CandidateScorer.getPreset('balanced'), CandidateScorer.normalizeWeights(CandidateScorer.DEFAULT_WEIGHTS),
    '默认权重必须等于 balanced 预设（两处各写一份迟早漂）');
  deepEq(CandidateScorer.getPreset('__not_exists__'), CandidateScorer.getPreset(CandidateScorer.DEFAULT_PRESET),
    '未知预设名必须回退默认档，不能崩也不能返回空对象');
});

test('A11 matchPreset 精确匹配才返回预设名，微调后必须诚实返回 null', function () {
  eq(CandidateScorer.matchPreset(CandidateScorer.getPreset('costFirst')), 'costFirst', '保守档应被识别');
  eq(CandidateScorer.matchPreset(CandidateScorer.getPreset('qualityFirst')), 'qualityFirst', '激进档应被识别');
  eq(CandidateScorer.matchPreset(null), CandidateScorer.DEFAULT_PRESET, '空配置应落在默认档上');
  var tweaked = CandidateScorer.getPreset('balanced');
  tweaked.nativeSubtitle = tweaked.nativeSubtitle + 1;   // 用户拖了一下滑块
  eq(CandidateScorer.matchPreset(tweaked), null,
    '拖动过滑块就不是任何预设了，必须返回 null（面板显示自定义）——返回预设名是在骗人');
});

test('A12 预设真的改变排序：保守压住无字幕干货，激进放行（v9.5 的意义所在）', function () {
  // 保守（省 ASR）：无字幕的干货视频被打到 C，有字幕的娱乐视频进 A
  eq(tierUnder('costFirst', PRE_CAND.strongNoSub), 'C',
    '保守档应把无字幕干货压到 C（宁缺毋滥，不烧 ASR），实际 ' + totalUnder('costFirst', PRE_CAND.strongNoSub));
  eq(tierUnder('costFirst', PRE_CAND.subButFun), 'A',
    '保守档应把有字幕视频放进 A，实际 ' + totalUnder('costFirst', PRE_CAND.subButFun));
  // 激进（要干货）：反过来
  eq(tierUnder('qualityFirst', PRE_CAND.strongNoSub), 'A',
    '激进档应把无字幕干货放进 A（内容为王），实际 ' + totalUnder('qualityFirst', PRE_CAND.strongNoSub));
  ok(totalUnder('costFirst', PRE_CAND.subButFun) > totalUnder('qualityFirst', PRE_CAND.subButFun),
    '同一视频在保守档得分必须高于激进档（有字幕是保守档的核心偏好）');
});

test('A13 预设不越权：又全又好的三档都是 A，命中排除词的三档都是 C', function () {
  ['costFirst', 'balanced', 'qualityFirst'].forEach(function (p) {
    eq(tierUnder(p, PRE_CAND.subAndStrong), 'A',
      '有字幕且干货的视频在 ' + p + ' 档必须是 A（好内容不该被预设摆布）');
    eq(tierUnder(p, PRE_CAND.liveReplay), 'C',
      '命中排除词「直播回放」的视频在 ' + p + ' 档必须是 C（排除词硬生效，没有预设能捞它）');
  });
});

// ============================================================
// B. SearchFilter 纯函数
// ============================================================

test('B1 parseCount 兼容万/亿/逗号/脏值', function () {
  eq(SearchFilter.parseCount('1.2万'), 12000, '万');
  eq(SearchFilter.parseCount('3亿'), 300000000, '亿');
  eq(SearchFilter.parseCount('12,345'), 12345, '千分位');
  eq(SearchFilter.parseCount(2048), 2048, '数字原样');
  eq(SearchFilter.parseCount(undefined), 0, 'undefined');
  eq(SearchFilter.parseCount('abc'), 0, '脏字符串');
});

test('B2 parseBiliDuration / parseIsoDuration', function () {
  eq(SearchFilter.parseBiliDuration('12:34'), 754, 'mm:ss');
  eq(SearchFilter.parseBiliDuration('1:02:03'), 3723, 'hh:mm:ss');
  eq(SearchFilter.parseBiliDuration(''), 0, '空串');
  eq(SearchFilter.parseBiliDuration('abc'), 0, '脏值');
  eq(SearchFilter.parseBiliDuration(120), 120, '数字原样');
  eq(SearchFilter.parseIsoDuration('PT1H30M'), 5400, 'YouTube ISO 时长');
  eq(SearchFilter.parseIsoDuration('PT45S'), 45, '秒');
  eq(SearchFilter.parseIsoDuration('P1DT2H'), 93600, '天+小时');
  eq(SearchFilter.parseIsoDuration('garbage'), 0, '脏值');
});

test('B3 normalizeBilibili：字幕标记 "false" 字符串必须归一为 false（回归）', function () {
  var item = SearchFilter.normalizeBilibili({ bvid: 'BV1', title: '<em>测试</em>&amp;视频', duration: '10:05' });
  eq(item.hasNativeSubtitle, null, '缺省为 null（未知）');
  eq(item.durationSec, 605, '时长转换');
  eq(item.title, '测试&视频', 'HTML 反转义');
  eq(SearchFilter.normalizeBilibili({ hasNativeSubtitle: 'false' }).hasNativeSubtitle, false,
    '字符串 "false" 不能变成 true');
  eq(SearchFilter.normalizeBilibili({ hasNativeSubtitle: 'true' }).hasNativeSubtitle, true, '字符串 "true"');
  eq(SearchFilter.normalizeBilibili({ hasNativeSubtitle: false }).hasNativeSubtitle, false, '布尔 false');
});

test('B4 filterCandidates 各筛选项', function () {
  var items = [
    { id: '1', durationSec: 100, play: 10, hasNativeSubtitle: true, score: { total: 60 }, pubdate: '2026-01-10T00:00:00.000Z' },
    { id: '2', durationSec: 2000, play: 5000, hasNativeSubtitle: false, score: { total: 10 }, pubdate: '2025-01-01T00:00:00.000Z' },
    { id: '3', durationSec: 700, play: 100, hasNativeSubtitle: true, score: { total: 40 }, pubdate: '' }
  ];
  eq(SearchFilter.filterCandidates(items, { minDurationSec: 600 }).length, 2, '最短时长');
  eq(SearchFilter.filterCandidates(items, { maxDurationSec: 800 }).length, 2, '最长时长');
  eq(SearchFilter.filterCandidates(items, { minPlay: 100 }).length, 2, '最低播放');
  eq(SearchFilter.filterCandidates(items, { nativeOnly: true }).length, 2, '仅原生字幕');
  eq(SearchFilter.filterCandidates(items, { minScore: 40 }).length, 2, '最低分');
  eq(SearchFilter.filterCandidates(items, { publishedAfter: '2025-06-01' }).length, 1, '发布时间过滤');
  eq(SearchFilter.filterCandidates(null, {}).length, 0, 'null 输入');
});

test('B5 randomDelayMs：范围 800–1500，NaN 注入不破防', function () {
  for (var i = 0; i < 200; i++) {
    var ms = SearchFilter.randomDelayMs();
    ok(ms >= 800 && ms <= 1500, '默认随机延迟应在 800–1500ms，实际 ' + ms);
  }
  eq(SearchFilter.randomDelayMs(function () { return 0; }), 800, '下界');
  eq(SearchFilter.randomDelayMs(function () { return 1; }), 1500, '上界');
  var guarded = SearchFilter.randomDelayMs(function () { return NaN; });
  ok(guarded >= 800 && guarded <= 1500, 'NaN 注入应回落中值而非 NaN，实际 ' + guarded);
});

// ============================================================
// C. TranscriptQuality 转写质量
// ============================================================

test('C1 dedupeAdjacentCues：精确重复 / 部分重叠 / 包含 / 空行', function () {
  var deduped = TranscriptQuality.dedupeAdjacentCues([
    { from: 0, to: 2, content: '大家好' },
    { from: 2, to: 4, content: '大家好' },   // 精确重复：自动字幕滚动
    { from: 4, to: 6, content: '欢迎来到' }
  ]);
  eq(deduped.length, 2, '精确重复应被去掉');
  eq(deduped[0].content, '大家好', '保留首现');
  eq(deduped[0].to, 4, '重复行时间并到前一条');
  eq(deduped[1].content, '欢迎来到', '后续内容保留');

  var overlap = TranscriptQuality.dedupeAdjacentCues([
    { from: 0, to: 2, content: '今天我们来' },
    { from: 2, to: 4, content: '我们来学习Python' }
  ]);
  eq(overlap.length, 2, '部分重叠应保留两条');
  eq(overlap[1].content, '学习Python', '重叠尾巴「我们来」应被剪掉');

  var contained = TranscriptQuality.dedupeAdjacentCues([
    { from: 0, to: 2, content: '今天我们来学习Python编程' },
    { from: 2, to: 4, content: '学习Python' }   // 是上一条的子串
  ]);
  eq(contained.length, 1, '短行是长行子串时应视为重复');

  var withEmpty = TranscriptQuality.dedupeAdjacentCues([
    { from: 0, to: 2, content: '' },
    { from: 2, to: 4, content: '   ' },
    { from: 4, to: 6, content: '你好' }
  ]);
  eq(withEmpty.length, 1, '空白行应被过滤');
});

test('C2 polishBody/bodyToAiText：2 秒一行的碎片合并成 15–40 字自然句', function () {
  // 每条恰好 5 字（'01的内容' 样式），共 12 条 = 60 字，行间隔 2 秒、gap 0.2s 不加标点
  var fragments = [];
  for (var i = 0; i < 12; i++) {
    var word = ('0' + (i + 1)).slice(-2) + '的内容';
    fragments.push({ from: i * 2, to: i * 2 + 1.8, content: word });
  }
  var lines = TranscriptQuality.bodyToAiText(fragments).split('\n');
  eq(lines.length, 2, '60 字碎片应合并成 2 句（40 + 20）');
  lines.forEach(function (line, i) {
    var len = plainLen(line);
    ok(len >= 15 && len <= 40, '第 ' + (i + 1) + ' 句长度应在 15–40 字，实际 ' + len);
  });
  eq(plainLen(lines[0]), 40, '第一句恰好到 40 字上限（不得被单条碎片顶破）');
  eq(plainLen(lines[1]), 20, '第二句 20 字');
  ok(/[。！？…]$/.test(lines[lines.length - 1]), '末句应以句号收尾');
});

test('C3 polishBody：疑问尾词补问号；够 15 字自然结束即断句，短句才合并', function () {
  // 16 字疑问句：补问号后达到 15 字下限，应独立成句
  var polished = TranscriptQuality.polishBody([
    { from: 0, to: 1, content: '那么这个问题你今天能够给出答案吗' },
    { from: 1, to: 2, content: '我们今天来讲清楚' }
  ]);
  eq(polished.length, 2, '16 字疑问句应独立断句');
  eq(polished[0].content, '那么这个问题你今天能够给出答案吗？', '疑问语气词应补问号');
  eq(polished[1].content, '我们今天来讲清楚。', '后续短句句号收尾');
  // 两句都短于 15 字：应合并成一句
  var merged = TranscriptQuality.polishBody([
    { from: 0, to: 1, content: '这个问题' },
    { from: 1, to: 2, content: '你会吗' }
  ]);
  eq(merged.length, 1, '两句都不足 15 字应合并');
  eq(merged[0].content, '这个问题，你会吗？', '合并句内加逗号、问号保留');
  ok(TranscriptQuality.polishBody([{ from: 0, to: 1, content: '你好' }], { punctuation: false })[0].content === '你好',
    '关闭标点恢复时应原样返回（仅去重）');
});

test('C4 bodyToAnchoredText：只到 3–5 分钟大锚点，格式 [mm:ss]', function () {
  var body = [
    { from: 0, to: 10, content: '开场白' },
    { from: 100, to: 110, content: '第一部分' },
    { from: 260, to: 270, content: '第二部分' },
    { from: 400, to: 410, content: '第三部分' },
    { from: 500, to: 510, content: '第四部分' }
  ];
  // 短句在 polishBody 里按自然句合并：前四句攒到 15 字断在一句（0–410s），末句独立（500s）
  var text = TranscriptQuality.bodyToAnchoredText(body, 240);
  var groups = text.split('\n\n');
  eq(groups.length, 2, '按自然句起点分桶：0s 与 500s 各一组');
  ok(/^\[\d{2}:\d{2}\]$/.test(groups[0].split('\n')[0]), '锚点头格式 [mm:ss]');
  eq(groups[0].split('\n')[0], '[00:00]', '第一组锚点');
  eq(groups[1].split('\n')[0], '[08:20]', '第二组锚点（500s）');
  ok(text.indexOf('开场白') >= 0, '锚点稿应包含正文');
  // 锚点间隔传入 10 / 9999 都应被截断到 180–300 秒
  var clamped = TranscriptQuality.bodyToAnchoredText(body, 10);
  eq(clamped.split('\n\n').length, 2, '锚点间隔截断到 180 秒后仍为 2 组');
  ok(clamped.indexOf('[00:00]') === 0, '截断后第一组仍从 0 开始');
});

test('C5 buildHotwords：热词来自视频自身元数据（标题/UP主/分区/标签/简介）', function () {
  var hotwords = TranscriptQuality.buildHotwords({
    title: 'Python从零入门教程',
    author: '阿Tri',
    typename: '计算机技术',
    tags: '编程,Python,教程',
    desc: '这里是简介内容。第二句话。'
  });
  ok(hotwords.indexOf('Python从零入门教程') >= 0, '标题本身应成为热词');
  ok(hotwords.indexOf('编程') >= 0, '标签应成为热词');
  ok(hotwords.indexOf('阿Tri') >= 0, 'UP 主名应成为热词');
  ok(hotwords.indexOf('这里是简介内容') >= 0, '简介短句应成为热词');
  hotwords.forEach(function (term) {
    ok(term.length >= 2 && term.length <= 32, '热词长度应在 2–32，实际 ' + term.length);
  });
  eq(new Set(hotwords).size, hotwords.length, '热词应去重');
  ok(hotwords.length <= 80, '热词应有数量上限');
  var withCustom = TranscriptQuality.buildHotwords({ title: 'x' }, '自定义术语A,自定义术语B');
  ok(withCustom.indexOf('自定义术语A') >= 0, '自定义术语应并入热词');
});

test('C6 parseCorrectionResponse：合格响应应用，条目数/顺序/空内容一律拒绝', function () {
  var original = [{ from: 0, to: 1, content: '原文一号' }, { from: 1, to: 2, content: '原文二号' }];
  var good = TranscriptQuality.parseCorrectionResponse(
    '{"corrected":[{"index":0,"content":"原文一号"},{"index":1,"content":"原文二号改"}],"changes":[{"from":"二号","to":"二号改"}]}',
    original);
  eq(good.body[1].content, '原文二号改', '纠错内容应被应用');
  eq(good.body[0].from, 0, '时间戳应保留');
  eq(good.changes.length, 1, '变更清单应列出');
  deepEq(good.changes[0], { from: '二号', to: '二号改' }, '变更清单内容');
  var fenced = TranscriptQuality.parseCorrectionResponse(
    '```json\n{"corrected":[{"index":0,"content":"a"},{"index":1,"content":"b"}],"changes":[]}\n```', original);
  eq(fenced.body[0].content, 'a', 'Markdown 代码围栏应被剥离');
  throws(function () {
    TranscriptQuality.parseCorrectionResponse('{"corrected":[{"index":0,"content":"a"}]}', original);
  }, '条目数改变必须拒绝');
  throws(function () {
    TranscriptQuality.parseCorrectionResponse('{"corrected":[{"index":1,"content":"a"},{"index":0,"content":"b"}]}', original);
  }, '顺序改变必须拒绝');
  throws(function () {
    TranscriptQuality.parseCorrectionResponse('{"corrected":[{"index":0,"content":""},{"index":1,"content":"b"}]}', original);
  }, '空内容必须拒绝');
  throws(function () {
    TranscriptQuality.parseCorrectionResponse('完全不是 JSON', original);
  }, '非 JSON 必须拒绝');
  var noChange = TranscriptQuality.parseCorrectionResponse(
    '{"corrected":[{"index":0,"content":"原文一号"},{"index":1,"content":"原文二号"}],"changes":[{"from":"同","to":"同"}]}',
    original);
  eq(noChange.changes.length, 0, 'from===to 的伪变更应被过滤');
});

test('C7 buildCorrectionPrompt：约束文案 + 视频元数据都在 prompt 里', function () {
  var prompt = TranscriptQuality.buildCorrectionPrompt(
    [{ from: 0, to: 1, content: '待校对文字' }],
    { title: '视频标题甲', desc: '简介乙', author: '阿Tri', typename: '知识', tags: '标签丙' });
  ok(prompt.indexOf('严禁改写句式') >= 0, '必须带「只改错字不改句式」约束');
  ok(prompt.indexOf('index、顺序和条目数完全不变') >= 0, '必须带条目数约束');
  ok(prompt.indexOf('视频标题甲') >= 0, 'prom 应带视频标题');
  ok(prompt.indexOf('待校对文字') >= 0, 'prompt 应带待校对字幕');
  ok(prompt.indexOf('"changes"' ) >= 0, '必须要求输出变更清单');
});

// ============================================================
// D. SegResume 断点续传状态层（v9.4）：纯函数 + GM 注入
// ============================================================

// 迷你 GM 存储：注入给模块，Node 里完整模拟「写坏 / 过期 / 换视频」
function fakeGM(initial) {
  var store = initial || {};
  return {
    get: function (key, dft) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : dft; },
    set: function (key, val) { store[key] = val; },
    raw: store
  };
}
var NOW = 1700000000000;
var VID = { bvid: 'BV1xx411c7mD', cid: 12345, url: 'https://upos-sz-mirror.bilivideo.com/abc.mp4?sig=deadbeef' };
var SEGS = [
  { from: 0, to: 120, content: '第一句' },
  { from: 120, to: 240, content: '第二句' }
];

test('D1 断点读写往返：同视频同 url 读回 doneCount 与 segs', function () {
  var gm = fakeGM();
  ok(SegResume.saveResume(gm.set, NOW, VID.bvid, VID.cid, VID.url, 7, SEGS), '保存应成功');
  var r = SegResume.loadResume(gm.get, NOW, VID.bvid, VID.cid, VID.url);
  ok(!!r, '同视频应读到断点');
  eq(r.doneCount, 7, 'doneCount 应原样读回');
  deepEq(r.segs, SEGS, 'segs 应原样读回');
});

test('D2 换视频 / 换 cid / 换 url 一律当没有断点（音频地址带签名，变了旧偏移全作废）', function () {
  var gm = fakeGM();
  SegResume.saveResume(gm.set, NOW, VID.bvid, VID.cid, VID.url, 7, SEGS);
  ok(SegResume.loadResume(gm.get, NOW, 'BV OTHER', VID.cid, VID.url) === null, '换 bvid 必须读不到');
  ok(SegResume.loadResume(gm.get, NOW, VID.bvid, 999, VID.url) === null, '换 cid 必须读不到');
  ok(SegResume.loadResume(gm.get, NOW, VID.bvid, VID.cid, VID.url + '&x=1') === null, '换 url 必须读不到');
  ok(SegResume.loadResume(gm.get, NOW, VID.bvid, null, VID.url) === null, 'cid 丢失必须读不到');
});

test('D3 超 24 小时与时钟回拨都算过期', function () {
  var gm = fakeGM();
  SegResume.saveResume(gm.set, NOW, VID.bvid, VID.cid, VID.url, 3, SEGS);
  ok(SegResume.loadResume(gm.get, NOW + SegResume.TTL_MS - 1, VID.bvid, VID.cid, VID.url) !== null, '临界的最后一秒仍有效');
  ok(SegResume.loadResume(gm.get, NOW + SegResume.TTL_MS, VID.bvid, VID.cid, VID.url) === null, '满 24 小时必须过期');
  ok(SegResume.loadResume(gm.get, NOW - 60000, VID.bvid, VID.cid, VID.url) === null, '时钟回拨必须算过期');
});

test('D4 脏数据不进场：JSON 坏 / 字段缺 / segs 形状错都被消毒或拒绝', function () {
  var gm = fakeGM({ bsr_seg_resume: '{烂掉的JSON' });
  ok(SegResume.loadResume(gm.get, NOW, VID.bvid, VID.cid, VID.url) === null, 'JSON 烂当没有断点');
  gm = fakeGM({ bsr_seg_resume: 'null' });
  ok(SegResume.loadResume(gm.get, NOW, VID.bvid, VID.cid, VID.url) === null, '存了 null 当没有断点');
  // 形状对的脏 segs：缺 content / 缺时间 / content 非字符串——逐条清掉，保留好条目
  var gm2 = fakeGM();
  SegResume.saveResume(gm2.set, NOW, VID.bvid, VID.cid, VID.url, 2, SEGS);
  var st = JSON.parse(gm2.raw.bsr_seg_resume);
  st.segs = st.segs.concat([{ from: 1 }, { to: 2, content: '缺起点' }, { from: 1, to: 2, content: 42 }, null]);
  gm2.set('bsr_seg_resume', JSON.stringify(st));
  var r = SegResume.loadResume(gm2.get, NOW, VID.bvid, VID.cid, VID.url);
  ok(!!r, '断点本身应仍可读');
  eq(r.segs.length, 2, '坏条目应被清掉，只剩 2 条好条目');
  r.segs.forEach(function (s) {
    ok(typeof s.content === 'string' && isFinite(s.from) && isFinite(s.to), '消完毒的条目形状必须完整');
  });
  // doneCount 是负数 / 非数字：手改存储绕过 saveResume 的钳制，读侧必须拒绝
  var gm3 = fakeGM();
  var base = { t: NOW, bvid: VID.bvid, cid: String(VID.cid), url: VID.url, segs: SEGS };
  gm3.set('bsr_seg_resume', JSON.stringify(Object.assign({}, base, { doneCount: -5 })));
  ok(SegResume.loadResume(gm3.get, NOW, VID.bvid, VID.cid, VID.url) === null, '负 doneCount 必须拒绝');
  gm3.set('bsr_seg_resume', JSON.stringify(Object.assign({}, base, { doneCount: 'abc' })));
  ok(SegResume.loadResume(gm3.get, NOW, VID.bvid, VID.cid, VID.url) === null, '非数字 doneCount 必须拒绝');
});

test('D5 clearResume 后读回 null；doneCount 超大批数由调用方截断，模块不越权', function () {
  var gm = fakeGM();
  SegResume.saveResume(gm.set, NOW, VID.bvid, VID.cid, VID.url, 5, SEGS);
  SegResume.clearResume(gm.set);
  ok(SegResume.loadResume(gm.get, NOW, VID.bvid, VID.cid, VID.url) === null, '清完后必须读不到');
  // 空 segs + doneCount 0：有效断点（调用方据此判断「没有可跳过的批」）
  var gm2 = fakeGM();
  SegResume.saveResume(gm2.set, NOW, VID.bvid, VID.cid, VID.url, 0, []);
  var r0 = SegResume.loadResume(gm2.get, NOW, VID.bvid, VID.cid, VID.url);
  ok(!!r0 && r0.doneCount === 0 && r0.segs.length === 0, 'doneCount 0 是有效断点');
});

test('D6 超 3MB 不写并返回 false（调用方记一笔，不能让用户以为存上了）', function () {
  var gm = fakeGM();
  var huge = [];
  for (var i = 0; i < 40000; i++) huge.push({ from: i, to: i + 1, content: 'x'.repeat(100) });
  var okSaved = SegResume.saveResume(gm.set, NOW, VID.bvid, VID.cid, VID.url, 40000, huge);
  ok(okSaved === false, '超限必须返回 false');
  ok(gm.raw.bsr_seg_resume === undefined, '超限不得落盘');
});

// ---------- 汇总 ----------
console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) {
  console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情');
  process.exit(1);
}
console.log('全部通过，退出码 0');
process.exit(0);
