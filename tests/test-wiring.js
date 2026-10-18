/**
 * 接线验证测试：防止「模块写了但没接进 UI」再次发生。
 *
 * 事故背景（2026-10-17）：v9.1 的三个模块（candidate-scorer / search-filter /
 * transcript-quality）在主脚本里只有定义和实例化，零调用方——功能写了，
 * 用户摸不到，@description 却在宣传。本测试把「接线」变成可断言的现实。
 *
 * 判定方法：静态读取 bili-subtitle.user.js 源码，要求每个对外函数
 * ① 在模块 return 里导出 ② 在主脚本里有定义之外的调用点。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');
const BUILD = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' —— ' + detail : '')); }
}

// 统计一个标识符在源码中的出现次数
function countOf(id, src) {
  const re = new RegExp('\\b' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  return ((src || SRC).match(re) || []).length;
}

// 提取函数体（按花括号配对，遇到字符串/正则里的括号会数错——因此只用于
// 本文件里那些不含花括号字面量的纯逻辑函数）。
// 为什么必须有它：v9.5 的第一版断言用 [\s\S]*? 跨函数匹配，
// 结果「refreshWeightSliders 里同步高亮」这条在真删掉调用后仍然 PASS——
// 正则吃到了下一个函数里的同名调用。断言必须限定在被测函数体内才算数。
function fnBody(name, src) {
  const s = src || SRC;
  const start = s.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let depth = 0, seen = false;
  for (let i = s.indexOf('{', start); i < s.length; i++) {
    const c = s[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') {
      depth--;
      if (seen && depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

// 模块源码（定义侧）：从 build.js 的清单反查文件
function moduleSource(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'modules', file), 'utf8');
}
const MODULE_FILES = {
  CandidateScorer: 'candidate-scorer.js',
  SearchFilter: 'search-filter.js',
  TranscriptQuality: 'transcript-quality.js'
};

// 1. 三个模块都被实例化
check('CandidateScorer 已实例化', /var CandidateScorer = createCandidateScorerModule\(\);/.test(SRC));
check('SearchFilter 已实例化', /var SearchFilter = createSearchFilterModule\(\);/.test(SRC));
check('TranscriptQuality 已实例化', /var TranscriptQuality = createTranscriptQualityModule\(\);/.test(SRC));

// 2. 接线判定（修正版）：函数在模块文件里有定义（导出）+ 在主脚本里有
//    「实例名.函数名」调用。定义与调用分居两地，不能再用总次数一刀切。
const WIRING = [
  ['CandidateScorer', 'scoreCandidate', '评分函数有调用方'],
  ['CandidateScorer', 'normalizeWeights', '权重归一化有调用方'],
  ['SearchFilter', 'searchBilibili', 'B站搜索有调用方'],
  ['SearchFilter', 'searchYouTube', 'YouTube 搜索有调用方'],
  ['SearchFilter', 'filterCandidates', '结果过滤有调用方'],
  ['TranscriptQuality', 'polishBody', '字幕增强有调用方'],
  ['TranscriptQuality', 'bodyToAiText', 'AI 纯文本导出有调用方'],
  ['TranscriptQuality', 'bodyToAnchoredText', '章节锚点导出有调用方'],
  ['TranscriptQuality', 'buildHotwords', '热词构建有调用方'],
  ['TranscriptQuality', 'buildCorrectionPrompt', 'LLM 纠错提示词有调用方'],
  ['TranscriptQuality', 'parseCorrectionResponse', 'LLM 纠错响应校验有调用方']
];
WIRING.forEach(function (entry) {
  const mod = entry[0], fn = entry[1];
  const defined = new RegExp('function ' + fn + '\\b').test(moduleSource(MODULE_FILES[mod]))
    && new RegExp(fn + '\\s*:').test(moduleSource(MODULE_FILES[mod]));   // 导出清单里也有
  // 调用判定：① 主脚本里有「实例.函数」限定调用；② 或模块内（已内联进主脚本）
  //    有真实调用（函数定义占 1 次，再加 ≥1 次调用 = 出现 ≥2 次）。
  //    例：normalizeWeights 只在 scoreCandidate 内部被本地调用，没有 CandidateScorer. 前缀，
  //    但确被使用，不应判为死代码。
  const callRe = new RegExp('\\b' + fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(', 'g');
  const internalCalls = (SRC.match(callRe) || []).length >= 2;
  const called = countOf(mod + '.' + fn) >= 1 || internalCalls;
  check(entry[2] + '（' + mod + '.' + fn + '）', defined && called,
    '定义=' + defined + ' 调用次数=' + countOf(mod + '.' + fn) + ' 内部调用=' + internalCalls);
});

// 3. 新增 UI 元素 id：HTML 里定义一次 + JS 里 querySelector 至少一次
const UI_IDS = ['bsrPaneSub', 'bsrPaneSearch', 'bsrSearchBtn', 'bsrSearchKw', 'bsrSearchResults',
  'bsrSearchStatus', 'bsrSearchPlatform', 'bsrSearchOrder', 'bsrSearchNative', 'bsrSearchMinPlay',
  'bsrResumeRow', 'bsrResumeTip', 'bsrAsrRestart',
  'bsrAiTxt', 'bsrAnchor', 'bsrCorrect', 'bsrPolishOn', 'bsrHotwordsOn', 'bsrLlmCorrect',
  'bsrCustomHotwords', 'bsrYtKey', 'bsrYtEye'];
UI_IDS.forEach(function (id) {
  const inHtml = new RegExp('id="' + id + '"').test(SRC);
  // render() 里有 $ = querySelector 简写，两种形式都认
  const inJs = new RegExp("querySelector\\('#" + id + "'\\)").test(SRC)
    || new RegExp("\\$\\('#" + id + "'\\)").test(SRC);
  check('UI 元素 ' + id + ' 两侧都在', inHtml && inJs, 'HTML=' + inHtml + ' JS=' + inJs);
});

// 4. 新设置项有持久化（SETTINGS 定义 + GM_setValue）
const SETTING_KEYS = ['polishOn', 'hotwordsOn', 'llmCorrect', 'ytKey', 'customHotwords'];
SETTING_KEYS.forEach(function (key) {
  check('设置项 SETTINGS.' + key + ' 已定义', new RegExp(key + ':').test(SRC));
  check('设置项 bsr_' + key.replace(/[A-Z]/g, function (m) { return '_' + m.toLowerCase(); }) + ' 已持久化',
    new RegExp("GM_setValue\\('bsr_" + key.replace(/[A-Z]/g, function (m) { return '_' + m.toLowerCase(); }) + "'").test(SRC));
});

// 5. 版本号与 CHANGELOG 对齐
const version = (SRC.match(/@version\s+([\d.]+)/) || [])[1];
const changelog = fs.existsSync(path.join(__dirname, '..', 'CHANGELOG.md'))
  ? fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8') : '';
check('@version 已读到', !!version, '没找到 @version');
check('CHANGELOG 含当前版本 ' + version, version && changelog.indexOf(version) >= 0, 'CHANGELOG 里找不到 ' + version);

// 6. 热词降级逻辑在位（不支持 hotwords 的账号不能把转写搞挂）
check('热词不支持时自动降级', /hotwordsFallbackDone/.test(SRC) && /已自动降级并关闭热词开关/.test(SRC));

// 7. v9.16 搜索筛选简化：砍掉 11 滑块权重面板，排序改走评分引擎默认权重
check('搜索结果用评分引擎的默认权重打分（不再给手调滑块）',
  /CandidateScorer\.scoreCandidate\(it, CandidateScorer\.DEFAULT_WEIGHTS\)/.test(SRC));
check('评分引擎在搜索里有真实调用方（不再是死代码）',
  countOf('CandidateScorer.scoreCandidate') >= 1);
check('排序：有字幕优先 → 评分降序 → 播放量降序',
  /hasNativeSubtitle === true \? 1 : 0/.test(SRC)
  && /_score/.test(SRC)
  && /Number\(b\.play\)/.test(SRC));
check('搜索结果卡片点击直接打开视频（去掉二次点击看理由）',
  /openCandidate\(search\.items\[i\]\)/.test(SRC));
check('搜索状态文案改为「有字幕优先 · 点卡片直接打开」',
  /有字幕优先 · 点卡片直接打开/.test(SRC));
check('旧的权重滑块 UI 已彻底移除（bsrWeight* 全部不存在）',
  !/bsrWeight/.test(SRC));

// 10. 候选评分模块导出健全性（test-scorer 依赖这些符号；getPreset/matchPreset 仍为模块内可用工具）
['WEIGHT_PRESETS', 'WEIGHT_PRESET_LABELS', 'DEFAULT_PRESET', 'getPreset', 'matchPreset', 'scoreCandidate', 'normalizeWeights'].forEach(function (sym) {
  var mod = moduleSource('candidate-scorer.js');
  var exported = new RegExp(sym + ':').test(mod);
  var defined = new RegExp('function ' + sym + '\\b').test(mod)
    || new RegExp('var ' + sym + '\\s*=').test(mod);
  check('CandidateScorer.' + sym + ' 已定义且已导出', defined && exported,
    '定义=' + defined + ' 导出=' + exported);
});
check('getPreset/matchPreset 仍是模块内可用函数（即便 UI 不再调，test-scorer 可覆盖）',
  /function getPreset\(/.test(moduleSource('candidate-scorer.js'))
  && /function matchPreset\(/.test(moduleSource('candidate-scorer.js')));

// 8. v9.4 断点续传接线（SegResume 模块 + 分段路接入 + 「重新开始」出口）
check('SegResume 已实例化', /var SegResume = createSegResumeModule\(\);/.test(SRC));
['loadResume', 'saveResume', 'clearResume'].forEach(function (fn) {
  var mod = moduleSource('seg-resume.js');
  var defined = new RegExp('function ' + fn + '\\b').test(mod) && new RegExp(fn + '\\s*:').test(mod);
  check('SegResume.' + fn + ' 有调用方', defined && countOf('SegResume.' + fn) >= 1,
    '定义=' + defined + ' 调用次数=' + countOf('SegResume.' + fn));
});
check('读断点带全视频标识（bvid + cid + url，少一个就对不上断点）',
  /SegResume\.loadResume\(GM_getValue, Date\.now\(\), state\.bvid \|\| '', state\.cid, url\)/.test(SRC));
check('读存储整体包 try（存储 API 出问题不挡住转写，大不了从头来）',
  /try \{[\s\S]{0,80}resume = SegResume\.loadResume/.test(SRC));
check('续传从断点批开始（for 起点是 doneCount，不是 0）',
  /for \(var bi = doneCount; bi < batches\.length; bi\+\+\)/.test(SRC));
check('每批完成即落盘（成功路径 + 失败路径共 2 处，中断才不丢）',
  countOf('SegResume.saveResume') >= 2, '实际 ' + countOf('SegResume.saveResume') + ' 处');
check('整批解码全失败不记 done（下次续传重试该批，不留永久缺口）',
  /SegResume\.saveResume\(GM_setValue, Date\.now\(\), state\.bvid \|\| '', state\.cid, url, bi, segsAll\)/.test(SRC));
check('整轮跑完才清断点，且清断点挂在「未取消」条件下（取消不清——断点就是为中断准备的）',
  /if \(!asrStop\(myGen\)\) \{\s+try \{ SegResume\.clearResume\(GM_setValue\); \}/.test(SRC));
check('「↺ 重新开始」清断点 + 作废旧轮次（asrGen++）+ 重启 ASR',
  /#bsrAsrRestart'\)\.onclick[\s\S]*?SegResume\.clearResume[\s\S]*?asrGen\+\+[\s\S]*?runAsr\(\)/.test(SRC));
check('断点提示行随 state.asr.resumed 显隐（render 里管，不是建完就不管）',
  /state\.asr\.resumed/.test(SRC) && /resumeRow\.style\.display = resuming/.test(SRC));

// v9.9 事故回归：modules/*.js 会被 build.js 整段塞进主脚本，而 run-tests.js 是
// 「按名字用正则抠函数体」来跑单测的。注入区里一旦出现同名的函数定义（哪怕在注释里），
// 抠到的就是模块里的版本 → 7 条 VTT 用例以 pad is not defined 集体红，
// 而且报错信息完全指不到真正的原因。这里把「注入区不得与提取名单重名」钉死。
const RT = fs.readFileSync(path.join(__dirname, 'run-tests.js'), 'utf8');
const funcsBlock = (RT.match(/const funcs = \[([\s\S]*?)\];/) || [])[1] || '';
const EXTRACTED = (funcsBlock.match(/'([A-Za-z_$][\w$]*)'/g) || []).map((s) => s.slice(1, -1));
const zoneA = SRC.indexOf('// <build:modules>');
const zoneB = SRC.indexOf('// </build:modules>');
const ZONE = zoneA >= 0 && zoneB > zoneA ? SRC.slice(zoneA, zoneB) : '';
const CLASH = EXTRACTED.filter((n) => new RegExp('function\\s+' + n + '\\s*\\(').test(ZONE));

check('单测提取名单非空（否则下一条是假绿）', EXTRACTED.length >= 20, '实际 ' + EXTRACTED.length + ' 个');
check('能取到 build:modules 注入区（否则下一条是假绿）', ZONE.length > 2000, '实际 ' + ZONE.length);
check('注入模块区不得出现与单测提取名单同名的函数（v9.9 事故：同名会让 run-tests 抠错函数）',
  CLASH.length === 0, '重名：' + CLASH.join('、'));
check('注入区的注释里也不许写出「function 名单名(」（正则连注释一起抠，同样会炸）',
  !EXTRACTED.some((n) => ZONE.indexOf('function ' + n + '(') >= 0), '注释里出现了同名串');

console.log('----------------------------------------');
console.log(fail === 0 ? 'PASS ' + pass + '/' + (pass + fail) : 'FAIL ' + fail + ' 项（共 ' + (pass + fail) + '）');
process.exit(fail === 0 ? 0 : 1);
