'use strict';

/**
 * tests/test-sub.js — v9.9 字幕内检索 + VTT 导出（纯函数 + 接线）
 *
 * 怎么跑：
 *   node tests/test-sub.js
 *
 * 为什么做这个：3 小时视频的转写稿有几千行。用户要的常常只是提到某个词的那几句，
 * 以前只能导出全文再粘到别处 Ctrl+F。现在检索之后，文本框只显示命中行，
 * 复制与导出也只出命中行——「筛选」和「产出」必须是同一件事，否则用户还得自己挑。
 */

var SubExport = require('../modules/sub-export.js');
var fs = require('fs');
var path = require('path');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');
var BUILD = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('[PASS] ' + name); }
  catch (e) { failed++; console.log('[FAIL] ' + name + ' — ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

var BODY = [
  { from: 0, to: 2, content: '你好，欢迎来到本期节目' },
  { from: 2, to: 5, content: '今天讲反向传播的原理' },
  { from: 5, to: 9, content: '反向传播是神经网络的核心' },
  { from: 9, to: 12, content: '先复习一下梯度下降' },
  { from: 12, to: 15, content: '反向传播与梯度下降一起用' }
];

// ===================== A. 时间戳与 VTT =====================

test('A1 vttTime 格式：HH:MM:SS.mmm（点号毫秒，与 SRT 的逗号不同）', function () {
  eq(SubExport.vttTime(0), '00:00:00.000', '零点');
  eq(SubExport.vttTime(3661.5), '01:01:01.500', '1 小时 1 分 1.5 秒');
  eq(SubExport.vttTime(59.999), '00:00:59.999', '临界毫秒');
  ok(/\./.test(SubExport.vttTime(1.5)), '毫秒分隔符必须是点号');
});

test('A2 毫秒进位不产生 .1000（浮点会让 0.9996 算出 1000ms，写出 60 秒是脏数据）', function () {
  var s = SubExport.vttTime(59.9996);
  ok(s.indexOf('.1000') < 0, '不得出现 .1000，实际 ' + s);
  // 秒必须真的进到分：00:00:60.000 是播放器拒收的脏时间轴
  eq(s, '00:01:00.000', '59.9996 秒应进到 1 分 0 秒');
  eq(SubExport.vttTime(3599.9996), '01:00:00.000', '跨小时也要一路进位');
});

test('A3 bodyToVtt 结构：WEBVTT 头 + 序号递增 + 时间戳行 + 空行分隔', function () {
  var vtt = SubExport.bodyToVtt(BODY);
  var lines = vtt.split('\n');
  eq(lines[0], 'WEBVTT', '首行必须是 WEBVTT');
  eq(lines[1], '', '第二行空');
  eq(lines[2], '1', '第一条序号');
  eq(lines[3], '00:00:00.000 --> 00:00:02.000', '第一条时间轴');
  ok(vtt.indexOf('-->') > 0, '要有时间轴箭头');
  ok(/\n5\n00:00:12\.000 --> 00:00:15\.000/.test(vtt), '最后一条序号与时间戳');
});

test('A4 bodyToVtt 跳过脏行（缺 content / 时间非数字 / null）', function () {
  var dirty = [
    { from: 0, to: 1, content: '有效' },
    { from: 1, to: 2, content: '   ' },
    null,
    { from: 'x', to: 2, content: '时间坏了' },
    { from: 2, to: 3, content: '也有效' }
  ];
  var vtt = SubExport.bodyToVtt(dirty);
  ok(vtt.indexOf('有效') >= 0 && vtt.indexOf('也有效') >= 0, '有效行要保留');
  ok(vtt.indexOf('时间坏了') < 0, '脏行必须丢掉');
  ok(/\n1\n[\s\S]*\n2\n/.test(vtt), '序号必须连续，不能跳号');
});

// ===================== B. 检索 =====================

test('B1 单词命中：大小写不敏感，返回命中行与计数', function () {
  var r = SubExport.searchBody(BODY, '反向传播');
  eq(r.matched, 3, '命中数');
  eq(r.total, 5, '总数');
  eq(r.body.length, 3, '返回行数');
  var r2 = SubExport.searchBody(BODY, '反向');
  eq(r2.matched, 3, '部分词也要命中');
});

test('B2 多词是「与」语义：空格分开的词必须全部命中', function () {
  var r = SubExport.searchBody(BODY, '反向传播 梯度');
  eq(r.matched, 1, '只有一行同时含两个词');
  eq(r.body[0].content, '反向传播与梯度下降一起用', '命中内容');
  eq(SubExport.searchBody(BODY, '反向传播 不存在的词').matched, 0, '有词命中不了就是 0');
});

test('B3 空关键词 = 不过滤（调用方不必区分「没搜」和「全命中」）', function () {
  ['', '   ', null, undefined].forEach(function (kw) {
    var r = SubExport.searchBody(BODY, kw);
    eq(r.body.length, 5, '关键词 ' + JSON.stringify(kw) + ' 应原样返回');
    eq(r.filtering, false, '未启用过滤标记');
  });
});

test('B4 零命中返回空数组但保留总数（调用方据此提示「没找到」）', function () {
  var r = SubExport.searchBody(BODY, '量子纠缠');
  eq(r.matched, 0, '命中 0');
  eq(r.total, 5, '总数仍要报出来');
  eq(r.body.length, 0, '返回空');
});

test('B5 脏数据不崩：null / 非数组 / 缺字段一律跳过', function () {
  eq(SubExport.searchBody(null, '词').total, 0, 'null body');
  eq(SubExport.searchBody('不是数组', '词').total, 0, '字符串 body');
  var r = SubExport.searchBody([{ from: 0, to: 1, content: '有效' }, null, { from: 1, to: 2 }], '有效');
  eq(r.matched, 1, '只数有效行');
  eq(r.total, 1, '总数也只数有效行');
});

test('B6 spanOf：命中行的时间跨度与条数（用于显示「分布在 00:12 ~ 01:40」）', function () {
  var r = SubExport.searchBody(BODY, '反向传播');
  var span = SubExport.spanOf(r.body);
  eq(span.count, 3, '条数');
  eq(span.from, 2, '最早起点');
  eq(span.to, 15, '最晚终点');
  ok(SubExport.spanOf([]) === null, '空数组返回 null');
});

test('B7 bodyToText：只拼正文，不带时间戳', function () {
  var t = SubExport.bodyToText(BODY);
  eq(t.split('\n').length, 5, '五行');
  ok(t.indexOf('-->') < 0, '不得含时间轴');
});

// ===================== C. 接线 =====================

test('C1 activeBody 存在，且「零命中回退全文」（绝不导空文件）', function () {
  ok(/function activeBody\(\)/.test(SRC), '要有 activeBody');
  var body = SRC.slice(SRC.indexOf('function activeBody()'), SRC.indexOf('function activeBody()') + 900);
  ok(/r\.matched \? r\.body : state\.body/.test(body), '检索零命中必须回退全文');
  ok(/if \(cut\.length\) b = cut;/.test(body), '区间裁没了也要退回不裁（同样不给空文件）');
  ok(/if \(state\.searchKw\) \{/.test(body), '空关键词走过滤分支之外');
  ok(/SubExport\.shiftBody/.test(body), '要应用时间轴偏移');
});

test('C2 复制 / TXT / SRT 三个主按钮都走 activeBody（不是绕过过滤直接拿 state.body）', function () {
  var copy = SRC.match(/#bsrCopy'\)\.onclick[\s\S]{0,160}?;/);
  ok(!!copy && /bodyToTxt\(activeBody\(\)/.test(copy[0]), '复制要用 activeBody');
  var txt = SRC.match(/#bsrTxt'\)\.onclick[\s\S]{0,260}?;/);
  ok(!!txt && /bodyToTxt\(activeBody\(\)/.test(txt[0]), 'TXT 要用 activeBody');
  var srt = SRC.match(/#bsrSrt'\)\.onclick[\s\S]{0,280}?;/);
  ok(!!srt && /bodyToSrt\(activeBody\(\)/.test(srt[0]), 'SRT 要用 activeBody');
});

test('C3 反向断言：三个主按钮不得再直接吃 state.body（绕过过滤 = 检索白做）', function () {
  [/#bsrCopy'\)\.onclick[\s\S]{0,160}?;/, /#bsrTxt'\)\.onclick[\s\S]{0,260}?;/, /#bsrSrt'\)\.onclick[\s\S]{0,280}?;/]
    .forEach(function (re, i) {
      var m = SRC.match(re);
      ok(!!m, '要能取到按钮 ' + i);
      ok(!/bodyTo(?:Txt|Srt)\(state\.body\)/.test(m[0]), '按钮 ' + i + ' 不得直接用 state.body');
    });
});

test('C4 AI 文本 / 锚点稿也走 activeBody（检索后导出同样只出命中行）', function () {
  ok(/TranscriptQuality\.bodyToAiText\(activeBody\(\)/.test(SRC), 'AI 文本');
  ok(/TranscriptQuality\.bodyToAnchoredText\(activeBody\(\)/.test(SRC), '锚点稿');
});

test('C5 VTT 导出按钮：HTML 有、JS 有绑定、走 activeBody 与 bodyToVtt', function () {
  ok(/id="bsrVtt"/.test(SRC), '要有按钮');
  ok(/#bsrVtt'\)\.onclick/.test(SRC), '要有绑定');
  ok(/SubExport\.bodyToVtt\(activeBody\(\)/.test(SRC), '要用 bodyToVtt(activeBody())');
  ok(/\.vtt'/.test(SRC), '文件名后缀要是 .vtt');
});

test('C6 检索框：HTML 两侧都在，输入即筛，有清除出口', function () {
  ok(/id="bsrFind"/.test(SRC), '要有输入框');
  ok(/id="bsrFindClear"/.test(SRC), '要有清除按钮');
  ok(/#bsrFind'\)\.value = state\.searchKw/.test(SRC) || /\$\('#bsrFind'\)\.value = state\.searchKw/.test(SRC), 'render 要回填输入框');
  var m = SRC.match(/findInput\.oninput[\s\S]{0,160}?;/);
  ok(!!m && /state\.searchKw = findInput\.value\.trim\(\)/.test(m[0]), '输入要更新 state.searchKw');
  ok(/findClear\.onclick[\s\S]{0,160}state\.searchKw = ''/.test(SRC), '清除要清空关键词');
});

test('C7 检索结果要告诉用户「筛掉了多少」（不然复制出去少了内容还不知道）', function () {
  ok(/id="bsrFindInfo"/.test(SRC), '要有提示位');
  ok(/命中 ' \+ res\.matched \+ ' \/ ' \+ res\.total/.test(SRC), '要报命中/总数');
  ok(/没找到/.test(SRC), '零命中要明说');
  ok(/复制与导出只出命中行/.test(SRC), '要说明导出范围变了');
});

test('C8 字幕区显示过滤后的内容（不是全文）— 行列表走 activeBody', function () {
  ok(/function renderLines\(\)/.test(SRC), '要有 renderLines');
  var fn = SRC.slice(SRC.indexOf('function renderLines()'), SRC.indexOf('function renderLines()') + 320);
  ok(/activeBody\(\)/.test(fn), '行列表渲染要走 activeBody（检索后只出命中行）');
});

test('C9 快捷键：Alt+S 开合 / Esc 收起 / Ctrl+Enter 取字幕，且输入框内不抢键', function () {
  ok(/hotkeysOn/.test(SRC), '要有开关');
  ok(/e\.altKey[\s\S]{0,240}togglePanel\(\)/.test(SRC), 'Alt+S 要切面板');
  ok(/e\.key === 'Escape'[\s\S]{0,220}classList\.remove\('show'\)/.test(SRC), 'Esc 要收起');
  ok(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === 'Enter'[\s\S]{0,80}getSubtitles\(\)/.test(SRC), 'Ctrl+Enter 要取字幕');
  ok(/var typing = !!\([^)]*tagName === 'INPUT'[\s\S]{0,60}TEXTAREA/.test(SRC), '要识别正在输入的场景');
  ok(/if \(!SETTINGS\.hotkeysOn\) return;/.test(SRC), '关掉后不响应');
});

test('C10 快捷键设置项：读取 / 保存 / 回填齐全，默认开', function () {
  ok(/hotkeysOn: GM_getValue\('bsr_hotkeys', true\)/.test(SRC), '默认开');
  ok(/GM_setValue\('bsr_hotkeys', SETTINGS\.hotkeysOn\)/.test(SRC), '要落盘');
  ok(/#bsrHotkeys'\)\.checked = SETTINGS\.hotkeysOn/.test(SRC), '要回填');
  ok(/SETTINGS\.hotkeysOn = root\.querySelector\('#bsrHotkeys'\)\.checked/.test(SRC), '保存要读 UI');
  ok(/id="bsrHotkeys"/.test(SRC), '要有控件');
});

test('C11 build.js 注册 sub-export 模块', function () {
  ok(BUILD.indexOf('sub-export.js') >= 0, 'build.js 要列出');
  ok(/var SubExport = createSubExportModule\(\);/.test(SRC), '主脚本要实例化');
  ok(SRC.indexOf('function createSubExportModule()') >= 0, '源码要注入');
});

test('C12 检索框只在有字幕时出现（没取字幕时不摆一个空框）', function () {
  ok(/fr\.style\.display = state\.body \? 'flex' : 'none'/.test(SRC), '要有字幕才显示');
});

// ===================== D. v9.10 Markdown / AI 提示词 =====================

test('D1 fmtClock：给人看的时间点（m:ss，过小时才加 h）', function () {
  eq(SubExport.fmtClock(0), '0:00', '零点');
  eq(SubExport.fmtClock(65), '1:05', '1 分 5 秒');
  eq(SubExport.fmtClock(3661), '1:01:01', '带小时时分钟补零');
  eq(SubExport.fmtClock(-5), '0:00', '负数归零');
  eq(SubExport.fmtClock('abc'), '0:00', '非数字归零');
});

test('D2 bodyToMd：标题 + 元信息 + 软换行（行尾两空格，否则渲染会被并成一个大段落）', function () {
  var md = SubExport.bodyToMd(BODY, { title: '测试视频', up: '某UP', lan: 'zh-CN' });
  var lines = md.split('\n');
  eq(lines[0], '# 测试视频', '一级标题');
  ok(md.indexOf('> UP：某UP') >= 0, '元信息行');
  ok(md.indexOf('---') >= 0, '分隔线');
  ok(/\n\*\*\[0:00\]\*\* 你好，欢迎来到本期节目  \n/.test(md), '条目格式与行尾两空格');
  ok(md.indexOf('**[0:12]**') >= 0, '最后一条时间戳');
});

test('D3 bodyToMd 脏输入不崩（空 / null / 缺 meta）', function () {
  ok(SubExport.bodyToMd([], {}).indexOf('# ') === 0, '空 body 也要有标题');
  ok(typeof SubExport.bodyToMd(null, null) === 'string', 'null 也返回字符串');
  ok(SubExport.bodyToMd([{ from: 0, to: 1, content: '有效' }, null], {}).indexOf('有效') >= 0, '跳过脏行');
});

test('D4 AI 提示词四套齐备（都有 id / name / 非空正文）', function () {
  eq(SubExport.AI_PROMPTS.length, 4, '四套');
  ['summary', 'points', 'notes', 'questions'].forEach(function (id) {
    var p = SubExport.getPrompt(id);
    ok(!!p, 'id ' + id + ' 要存在');
    ok(!!p.name && p.text.length > 10, id + ' 要有名字与正文');
  });
});

test('D5 getPrompt 未知名返回 null（调用方据此什么都不做，不复制垃圾）', function () {
  ok(SubExport.getPrompt('nope') === null, '未知 id');
  ok(SubExport.getPrompt('') === null, '空 id');
});

test('D6 buildPrompt：拼提示词 + 稿子；超长截断并注明（剪贴板塞几万字会被静默拒绝）', function () {
  var full = SubExport.buildPrompt('summary', '短稿子', 15000);
  ok(full.indexOf('短稿子') >= 0, '要带上稿子');
  ok(full.indexOf('---') >= 0, '要有分隔');
  var long = SubExport.buildPrompt('points', 'x'.repeat(20000), 15000);
  ok(long.length < 16000, '必须截断，实际 ' + long.length);
  ok(long.indexOf('已截断') >= 0, '要如实告诉用户截断了');
});

test('D7 buildPrompt 未知名返回空串（不复制没头没尾的东西）', function () {
  eq(SubExport.buildPrompt('nope', '稿子', 15000), '', '未知 id');
});

// ===================== E. v9.10 接线 =====================

test('E1 MD 导出：按钮 HTML + 绑定 + 走 bodyToMd 与 .md 后缀', function () {
  ok(/id="bsrMd"/.test(SRC), '要有按钮');
  ok(/#bsrMd'\)\.onclick/.test(SRC), '要有绑定');
  ok(/SubExport\.bodyToMd\(activeBody\(\)/.test(SRC), '要走 bodyToMd(activeBody())');
  ok(/\.md'/.test(SRC), '后缀 .md');
});

test('E2 AI 提示词区：HTML 两侧都在，按钮由 AI_PROMPTS 生成（不是手写死四行）', function () {
  ok(/id="bsrPromptToggle"/.test(SRC), '折叠开关');
  ok(/id="bsrPromptBox"/.test(SRC), '容器');
  ok(/id="bsrPrompts"/.test(SRC), '按钮宿主');
  ok(/SubExport\.AI_PROMPTS\.forEach/.test(SRC), '必须由模块数据生成');
  ok(/b\.textContent = p\.name/.test(SRC), '按钮显示名字');
  ok(/copyText\(SubExport\.buildPrompt\(/.test(SRC), '点击复制提示词+稿子');
});

test('E3 提示词带的是 activeBody（检索后只带命中行，不是整篇）', function () {
  ok(/SubExport\.buildPrompt\(p\.id, bodyToTxt\(activeBody\(\)/.test(SRC), '要用 activeBody');
});

test('E4 点击字幕行跳转：行列表可点击，按行取时间点（不再用 textarea 光标算行号）', function () {
  ok(/#bsrOut'\)\.onclick/.test(SRC), '行容器要有点击处理');
  ok(/\.closest\('\.bsr-line'\)/.test(SRC), '点击要落到某一行');
  ok(/getAttribute\('data-from'\)/.test(SRC), '行里带 data-from 时间戳');
  ok(/seekTo\(from\)/.test(SRC), '要跳到该行起点');
});

test('E5 seekTo：找不到播放器要明说，不能静默失败', function () {
  ok(/function seekTo\(/.test(SRC), '要有 seekTo');
  ok(/v\.currentTime = t;/.test(SRC), '必须真的改播放位置（只弹个提示不算跳转）');
  ok(/找不到可跳转的播放器/.test(SRC), '没有播放器要提示');
  ok(/跳转失败/.test(SRC), '写入失败也要提示');
  ok(/toast\('已跳到 '/.test(SRC), '跳了要告诉用户跳到哪');
});

test('E6 seekTo 不强求播放（自动播放被拦也不能报错吓人）', function () {
  var body = SRC.slice(SRC.indexOf('function seekTo('), SRC.indexOf('function seekTo(') + 700);
  ok(/if \(v\.paused\)/.test(body), '只在暂停时尝试播放');
  ok(/pr\.catch\(function \(\) \{\}\)/.test(body), '播放被拒要静默吞掉');
});

test('E7 点击跳转受设置控制（默认开，可在设置里关）', function () {
  ok(/clickSeekOn: GM_getValue\('bsr_click_seek', true\)/.test(SRC), '默认开');
  ok(/GM_setValue\('bsr_click_seek', SETTINGS\.clickSeekOn\)/.test(SRC), '要落盘');
  ok(/#bsrClickSeek'\)\.checked = SETTINGS\.clickSeekOn/.test(SRC), '要回填');
  ok(/SETTINGS\.clickSeekOn = root\.querySelector\('#bsrClickSeek'\)\.checked/.test(SRC), '保存要读 UI');
  ok(/if \(!SETTINGS\.clickSeekOn \|\| !state\.body\) return;/.test(SRC), '关掉后点击不跳');
});

test('E8 文本框告诉用户可以点（不然没人知道能跳）', function () {
  ok(/点某一行可以跳到视频的对应时间/.test(SRC), 'title 要写清楚');
});

// ===================== F. v9.11 时间轴校正 =====================

test('F1 shiftBody：整体平移，且不产生负时间戳（负时间戳的 SRT 播放器直接拒收）', function () {
  var late = SubExport.shiftBody(BODY, 3);
  eq(late[0].from, 3, '起点 +3');
  eq(late[0].to, 5, '终点 +3');
  eq(late[0].content, BODY[0].content, '文字不能动');
  var early = SubExport.shiftBody(BODY, -3);
  eq(early[0].from, 0, '起点被压到 0，不能是负的');
  eq(early[0].to, 2, '起点被压到 0 时保持原时长，不能压成「0 秒到 0 秒」的空条目');
  eq(early[3].from, 6, '够远的正常平移（9-3）');
  eq(early[3].to, 9, '时长保持');
  // 任何一条都不能出现 to <= from（0 时长或倒挂 = 播放器不显示）
  early.concat(late).forEach(function (x, i) { ok(x.to > x.from, '第 ' + i + ' 条 to 必须大于 from'); });
});

test('F2 shiftBody 偏移为 0 / 非法值时原样返回', function () {
  var r = SubExport.shiftBody(BODY, 0);
  eq(r.length, 5, '条数不变');
  eq(r[0].from, 0, '时间不变');
  eq(SubExport.shiftBody(BODY, 'abc').length, 5, '非法值按 0 处理');
});

test('F3 bodyFrom：只保留该时间点之后', function () {
  var r = SubExport.bodyFrom(BODY, 5);
  eq(r.length, 3, '5 秒之后有 3 条');
  eq(r[0].from, 5, '含边界');
  eq(SubExport.bodyFrom(BODY, 0).length, 5, '起点 0 = 不裁');
  eq(SubExport.bodyFrom(BODY, -10).length, 5, '负数 = 不裁');
  eq(SubExport.bodyFrom(BODY, 999).length, 0, '超范围裁空（调用方负责回退）');
});

test('F4 bodyRange：区间导出，to 缺省表示到结尾', function () {
  eq(SubExport.bodyRange(BODY, 2, 9).length, 2, '2~9 秒两条');
  eq(SubExport.bodyRange(BODY, 9).length, 2, '只给起点');
  eq(SubExport.bodyRange(BODY, 0, 999).length, 5, '全区间');
});

test('F5 三个时间轴函数对脏输入都不崩', function () {
  ok(Array.isArray(SubExport.shiftBody(null, 5)), 'shift null');
  ok(Array.isArray(SubExport.bodyFrom('不是数组', 5)), 'from 字符串');
  ok(Array.isArray(SubExport.bodyRange([null, { from: 0, to: 1, content: 'x' }], 0, 10)), '含脏行');
});

// ===================== G. v9.11 接线 =====================

test('G1 时间轴折叠区：HTML 两侧都在', function () {
  ok(/id="bsrAxisToggle"/.test(SRC), '折叠开关');
  ok(/id="bsrAxisBox"/.test(SRC), '容器');
  ok(/id="bsrShift"/.test(SRC), '偏移输入');
  ok(/id="bsrFromNow"/.test(SRC), '从当前位置按钮');
  ok(/id="bsrAxisClear"/.test(SRC), '清除按钮');
});

test('G2 偏移输入：有绑定、有回填、非法值归零', function () {
  var m = SRC.slice(SRC.indexOf('shiftInput.oninput'), SRC.indexOf('shiftInput.oninput') + 300);
  ok(/parseFloat\(shiftInput\.value\)/.test(m), '要读输入值');
  ok(/state\.shiftSec = isFinite\(n\) \? n : 0/.test(m), '非法值归零');
  ok(/si\.value = state\.shiftSec \? String\(state\.shiftSec\) : ''/.test(SRC), 'render 要回填');
});

test('G3 「只保留当前位置之后」：读不到播放位置要明说，不能静默啥也不干', function () {
  ok(/#bsrFromNow'\)\.onclick/.test(SRC), '要有绑定');
  ok(/读不到播放位置/.test(SRC), '读不到要提示');
  ok(/state\.rangeFrom = Math\.floor\(v\.currentTime\)/.test(SRC), '要写入起点');
});

test('G4 清除按钮同时清偏移与裁剪', function () {
  // 必须限定在清除按钮的处理里：整份源码里 resetForNewVideo 也写了同一串，
  // 只查全文的话「清了一半」的变异会被另一处顶住，出现假绿（v9.11 变异 M5 实测）。
  var clr = SRC.slice(SRC.indexOf("#bsrAxisClear').onclick"), SRC.indexOf("#bsrAxisClear').onclick") + 320);
  ok(clr.length > 50, '要能定位到清除按钮的处理');
  ok(/state\.shiftSec = 0; state\.rangeFrom = 0;/.test(clr), '清除按钮里两项都要清');
});

test('G5 换视频必须清掉检索词与时间轴校正（否则上一条的筛选套到新视频上）', function () {
  var body = SRC.slice(SRC.indexOf('function resetForNewVideo()'), SRC.indexOf('function resetForNewVideo()') + 900);
  ok(/state\.searchKw = ''; state\.shiftSec = 0; state\.rangeFrom = 0;/.test(body), 'reset 里必须清三项');
});

test('G6 开了校正要显示出来（不然导出时间戳偏了都不知道为什么）', function () {
  ok(/时间轴已整体/.test(SRC), '要提示偏移方向');
  ok(/已只保留/.test(SRC), '要提示裁剪起点');
});

test('G7 反向断言：偏移只能改时间，不得动文字', function () {
  var shifted = SubExport.shiftBody(BODY, 30);
  for (var i = 0; i < BODY.length; i++) {
    eq(shifted[i].content, BODY[i].content, '第 ' + i + ' 条文字必须逐字不变');
  }
});

console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) { console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情'); process.exit(1); }
console.log('全部通过，退出码 0');
process.exit(0);
