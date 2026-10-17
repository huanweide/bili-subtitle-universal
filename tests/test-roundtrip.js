'use strict';

/**
 * tests/test-roundtrip.js — 导出 → 再解析 往返一致性（v9.12）
 *
 * 怎么跑：
 *   node tests/test-roundtrip.js
 *
 * 为什么需要它：这个项目的价值是「导出的字幕能直接拿去用」。但以前只分别测了
 * 「解析器能不能吃标准格式」和「导出器能不能写出来」，没测过**自己导出的东西再解析回来
 * 还对不对**——于是 v9.0 之前那个「所有 VTT 导出的 SRT 结束时间都是 0」的事故，
 * 在两套各自为政的测试里都是绿的。
 *
 * 判定方法：造一份 body → 用源码里的 SRT/VTT 导出器写出文本 → 再用源码里的
 * SRT/VTT 解析器读回来 → 逐条比对时间（误差 < 5ms）与文字（逐字相同）。
 */

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var SRC = fs.readFileSync(path.join(ROOT, 'bili-subtitle.user.js'), 'utf8');
var SubExport = require(path.join(ROOT, 'modules', 'sub-export.js'));

// —— 从主脚本里抠纯函数（与 run-tests.js 同一套机制）——
function extractFunc(name) {
  var re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  var m = re.exec(SRC);
  if (!m) throw new Error('未找到函数 ' + name);
  var start = m.index + m[0].length - 1;
  var depth = 0, i;
  for (i = start; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(m.index, i + 1);
}
function extractVarValue(name) {
  var m = SRC.match(new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;'));
  if (!m) throw new Error('未找到变量 ' + name);
  return m[0];
}

var code = extractVarValue('SRT_TS') + '\n' +
  ['srtTime', 'bodyToSrt', 'parseSrt', 'vttTime', 'parseVtt', 'unescapeEntities'].map(extractFunc).join('\n') +
  '\nreturn { srtTime: srtTime, bodyToSrt: bodyToSrt, parseSrt: parseSrt, vttTime: vttTime, parseVtt: parseVtt, unescapeEntities: unescapeEntities };';
// eslint-disable-next-line no-new-func
var scope = new Function(code)();

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('[PASS] ' + name); }
  catch (e) { failed++; console.log('[FAIL] ' + name + ' — ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}
function close(a, b, tol, msg) {
  if (Math.abs(a - b) > (tol || 0.005)) {
    throw new Error((msg || '') + ' 期望≈' + b + '，实际 ' + a);
  }
}

// 比对两条字幕数组：条数、每条时间（容差 5ms）、每条文字逐字相同。
// 文字按 trim 后比对：解析器统一去掉首尾空白是**设计而非 bug**（字幕首尾空格没有意义，
// 留着还会让 SRT 导出多出空行），所以往返一致性比的是 trim 后的内容。
function assertSameBody(name, got, want) {
  eq(got.length, want.length, name + ' 条数');
  for (var i = 0; i < want.length; i++) {
    close(got[i].from, want[i].from, 0.005, name + ' 第 ' + i + ' 条起点');
    close(got[i].to, want[i].to, 0.005, name + ' 第 ' + i + ' 条终点');
    eq(String(got[i].content).trim(), String(want[i].content).trim(), name + ' 第 ' + i + ' 条文字');
  }
}

// —— 语料：覆盖真实字幕里最容易出现问题的几类内容 ——
var SIMPLE = [
  { from: 0, to: 2, content: '你好，欢迎来到本期节目' },
  { from: 2.5, to: 5.25, content: '这一节讲反向传播' },
  { from: 3661.5, to: 3720, content: '一小时之后的一句话' }
];

var NASTY = [
  { from: 0, to: 1.5, content: '带引号 "双引" 与 \'单引\'' },
  { from: 1.5, to: 3, content: '带尖括号 <b>加粗</b> 与 & 符号' },
  { from: 3, to: 4.5, content: '带数字 2026 年 10 月' },
  { from: 4.5, to: 6, content: ' 前后有空白的行 ' },
  { from: 6, to: 7.5, content: '时间箭头 --> 出现在正文里' },
  { from: 7.5, to: 9, content: 'emoji 🎬 与全角标点，。！？' },
  { from: 59.999, to: 61.001, content: '跨分钟的临界时间' }
];

var MULTILINE = [
  { from: 0, to: 3, content: '第一行\n第二行' },
  { from: 3, to: 6, content: '单行的下一句' }
];

// ===================== SRT 往返 =====================

test('R1 SRT 往返：普通语料写出来再读回来，时间文字逐条相同', function () {
  var text = scope.bodyToSrt(SIMPLE);
  assertSameBody('SRT', scope.parseSrt(text), SIMPLE);
});

test('R2 SRT 往返：尖括号 / 引号 / & / 数字正文 / emoji / 全角标点', function () {
  var text = scope.bodyToSrt(NASTY);
  var back = scope.parseSrt(text);
  assertSameBody('SRT', back, NASTY);
});

test('R3 SRT 往返：正文本身是纯数字不能被当成序号吞掉（v9.0 前的事故）', function () {
  var body = [
    { from: 0, to: 1, content: '1' },
    { from: 1, to: 2, content: '2026' },
    { from: 2, to: 3, content: '3' }
  ];
  var back = scope.parseSrt(scope.bodyToSrt(body));
  assertSameBody('SRT', back, body);
});

test('R4 SRT 往返：多行字幕不丢行', function () {
  var back = scope.parseSrt(scope.bodyToSrt(MULTILINE));
  assertSameBody('SRT', back, MULTILINE);
});

test('R4b 约定：解析器会去掉首尾空白（往返后内容按 trim 比，这是设计不是丢字）', function () {
  var body = [{ from: 0, to: 1, content: '   两边有空白   ' }];
  var back = scope.parseSrt(scope.bodyToSrt(body));
  eq(back.length, 1, '条数');
  eq(back[0].content, '两边有空白', '首尾空白应被去掉');
  var backV = scope.parseVtt(SubExport.bodyToVtt(body));
  eq(backV[0].content, '两边有空白', 'VTT 同样去掉');
});

test('R5 SRT 往返：临界毫秒不串位（59.999 → 61.001 不能被四舍五入吃掉）', function () {
  var body = [{ from: 59.999, to: 61.001, content: '临界' }];
  var back = scope.parseSrt(scope.bodyToSrt(body));
  eq(back.length, 1, '条数');
  close(back[0].from, 59.999, 0.002, '起点');
  close(back[0].to, 61.001, 0.002, '终点');
});

// ===================== VTT 往返 =====================

test('R6 VTT 往返：普通语料写出来再读回来', function () {
  var text = SubExport.bodyToVtt(SIMPLE);
  assertSameBody('VTT', scope.parseVtt(text), SIMPLE);
});

test('R7 VTT 往返：结束时间绝不能是 0（v9.0 前的打脸级事故）', function () {
  var back = scope.parseVtt(SubExport.bodyToVtt(SIMPLE));
  back.forEach(function (x, i) {
    ok(x.to > 0, '第 ' + i + ' 条结束时间不能为 0');
    ok(x.to > x.from, '第 ' + i + ' 条结束必须晚于开始');
  });
});

test('R8 VTT 往返：正文含 --> 不会被当成新的一条（VTT 解析按箭头切分，正文里的箭头是陷阱）', function () {
  var body = [{ from: 0, to: 2, content: '时间箭头 --> 出现在正文里' }];
  var back = scope.parseVtt(SubExport.bodyToVtt(body));
  ok(back.length === 1, '不能因为正文里有箭头就多切出一条，实际 ' + back.length + ' 条');
  ok(back[0].content.indexOf('-->') >= 0, '正文里的箭头必须原样保留');
});

test('R9 VTT 往返：跨小时时间轴', function () {
  var body = [{ from: 7325.5, to: 7330, content: '两小时后的内容' }];
  var back = scope.parseVtt(SubExport.bodyToVtt(body));
  eq(back.length, 1, '条数');
  close(back[0].from, 7325.5, 0.005, '起点 2:02:05.500');
  close(back[0].to, 7330, 0.005, '终点');
});

test('R10 VTT 时间戳不出现 .1000 或 60 秒（浮点进位写脏了会让播放器拒收）', function () {
  var body = [{ from: 59.9996, to: 3599.9996, content: '临界' }];
  var vtt = SubExport.bodyToVtt(body);
  ok(vtt.indexOf('.1000') < 0, '不得出现 .1000');
  ok(!/:\d{2}:60\./.test(vtt), '秒位不得出现 60：' + vtt);
  ok(vtt.indexOf('00:01:00.000') >= 0, '59.9996 必须进到 1 分整');
});

// ===================== 跨格式 =====================

test('R11 同一份 body 导成 SRT 与 VTT，解析回来应当完全一致（两条导出路不能各错各的）', function () {
  var viaSrt = scope.parseSrt(scope.bodyToSrt(SIMPLE));
  var viaVtt = scope.parseVtt(SubExport.bodyToVtt(SIMPLE));
  assertSameBody('VTT 对照 SRT', viaVtt, viaSrt);
});

test('R12 空 body 与单条 body 都不崩，也不产出畸形文件', function () {
  eq(SubExport.bodyToVtt([]).trim(), 'WEBVTT', '空 body 只有头');
  eq(scope.parseVtt(SubExport.bodyToVtt([])).length, 0, '空 body 解析回 0 条');
  var one = [{ from: 0, to: 1, content: '只有一句' }];
  assertSameBody('单条', scope.parseVtt(SubExport.bodyToVtt(one)), one);
});

test('R13 脏行被跳过而不是写进文件（缺 content / 时间非数字 / null）', function () {
  var dirty = [
    { from: 0, to: 1, content: '有效' },
    { from: 1, to: 2, content: '   ' },
    null,
    { from: 'x', to: 2, content: '时间坏了' }
  ];
  var vtt = SubExport.bodyToVtt(dirty);
  ok(vtt.indexOf('时间坏了') < 0, '脏行不得写进 VTT');
  var back = scope.parseVtt(vtt);
  eq(back.length, 1, '解析回来应有且只有 1 条');
  eq(back[0].content, '有效', '内容');
});

test('R14 VTT 序号必须从 1 连续递增（跳过脏行也不能跳号，跳号播放器会错位）', function () {
  var withDirty = [
    { from: 0, to: 1, content: '第一句' },
    { from: 1, to: 2, content: '   ' },        // 脏行：空内容
    { from: 2, to: 3, content: '第三句' }
  ];
  var vtt = SubExport.bodyToVtt(withDirty);
  var nums = [];
  vtt.split('\n').forEach(function (line) {
    if (/^\d+$/.test(line.trim()) && line.trim() !== '') nums.push(parseInt(line.trim(), 10));
  });
  eq(nums.length, 2, '只应有两条的序号');
  eq(nums[0], 1, '第一条序号必须是 1');
  eq(nums[1], 2, '第二条序号必须是 2（不能因为跳了脏行就写成 3）');
});

console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) { console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情'); process.exit(1); }
console.log('全部通过，退出码 0');
process.exit(0);
