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
  var body = SRC.slice(SRC.indexOf('function activeBody()'), SRC.indexOf('function activeBody()') + 400);
  ok(/r\.matched \? r\.body : state\.body/.test(body), '零命中必须回退全文');
  ok(/if \(!state\.searchKw\) return state\.body;/.test(body), '空关键词返回全文');
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

test('C8 文本框显示过滤后的内容（不是全文）', function () {
  ok(/\$\('#bsrOut'\)\.value = state\.body \? bodyToTxt\(activeBody\(\)/.test(SRC), '文本框要走 activeBody');
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

console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) { console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情'); process.exit(1); }
console.log('全部通过，退出码 0');
process.exit(0);
