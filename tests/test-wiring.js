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
  const called = countOf(mod + '.' + fn) >= 1;
  check(entry[2] + '（' + mod + '.' + fn + '）', defined && called,
    '定义=' + defined + ' 调用次数=' + countOf(mod + '.' + fn));
});

// 3. 新增 UI 元素 id：HTML 里定义一次 + JS 里 querySelector 至少一次
const UI_IDS = ['bsrPaneSub', 'bsrPaneSearch', 'bsrSearchBtn', 'bsrSearchKw', 'bsrSearchResults',
  'bsrSearchStatus', 'bsrSearchPlatform', 'bsrSearchOrder', 'bsrSearchNative', 'bsrSearchMinPlay',
  'bsrWeightBox', 'bsrWeightSliders', 'bsrWeights', 'bsrWeightSave', 'bsrWeightReset', 'bsrWeightToggle',
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
const SETTING_KEYS = ['polishOn', 'hotwordsOn', 'llmCorrect', 'ytKey', 'scoreWeights', 'customHotwords'];
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

// 7. v9.3 权重滑块接线（拖滑块即时生效 + 与 JSON 双向同步 + 松手落盘）
check('滑块按 WEIGHT_LABELS 渲染（不是写死的 HTML，新增权重自动多一项）',
  /Object\.keys\(CandidateScorer\.WEIGHT_LABELS\)\.forEach/.test(SRC));
check('滑块范围取自 WEIGHT_RANGE（与归一化截断边界同源，不货不对板）',
  /CandidateScorer\.WEIGHT_RANGE\.min/.test(SRC) && /CandidateScorer\.WEIGHT_RANGE\.max/.test(SRC));
check('滑块行带 data-w 键名（回刷时按键取值，不靠下标猜）', /data-w="' \+ key/.test(SRC));
check('拖动过程刷数值并同步 JSON（input 事件，不落盘）',
  /addEventListener\('input'/.test(SRC) && /syncSlidersToTextarea/.test(SRC));
check('松手才落盘（change → persistWeightsFromSliders）',
  /addEventListener\('change',\s*persistWeightsFromSliders\)/.test(SRC));
check('落盘写的是同一个设置键并即时重渲染（保存后当前结果换档）',
  /SETTINGS\.scoreWeights = root\.querySelector\('#bsrWeights'\)\.value;[\s\S]*?saveSettings\(\);[\s\S]*?render\(\);/.test(SRC));
check('JSON 保存/恢复默认后滑块回刷（两边不打架）',
  /#bsrWeightSave'\)\.onclick[\s\S]*?refreshWeightSliders\(\)/.test(SRC)
  && /#bsrWeightReset'\)\.onclick[\s\S]*?refreshWeightSliders\(\)/.test(SRC));
check('展开权重面板时滑块从当前设置回刷', /#bsrWeightToggle'\)\.onclick[\s\S]*?refreshWeightSliders\(\)/.test(SRC));
check('refreshWeightSliders 调用点足够（定义 + 展开/保存/重置/初始化 5 处）',
  countOf('refreshWeightSliders') >= 6, '实际 ' + countOf('refreshWeightSliders') + ' 处');

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

console.log('----------------------------------------');
console.log(fail === 0 ? 'PASS ' + pass + '/' + (pass + fail) : 'FAIL ' + fail + ' 项（共 ' + (pass + fail) + '）');
process.exit(fail === 0 ? 0 : 1);
