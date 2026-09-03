// 单元测试：从 bili-subtitle.user.js 真实源码中提取纯函数并验证
// 运行：node tests/run-tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');

// —— 提取工具：按名字提取 var / function（大括号配对）——
function extractVarArray(name) {
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\[[\\s\\S]*?\\];'));
  if (m) return m[0];
  const m2 = src.match(new RegExp("var\\s+" + name + "\\s*=\\s*'[^']*'\\.split\\('[^']*'\\)\\s*;"));
  if (m2) return m2[0];
  throw new Error('未找到数组变量 ' + name);
}
function extractVarObj(name) {
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\{[\\s\\S]*?\\};'));
  if (m) return m[0];
  throw new Error('未找到对象变量 ' + name);
}
function extractFunc(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) throw new Error('未找到函数 ' + name);
  const start = m.index + m[0].length - 1; // '{' 位置
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(m.index, i + 1);
}

// —— 组装可执行代码 ——
const funcs = [
  'add32', 'cmn', 'ff', 'gg', 'hh', 'ii', 'md5cycle', 'md5blk', 'md51', 'rhex', 'hex', 'md5',
  'getMixinKey', 'buildQs', 'wbiSign', 'wbiQuery',
  'srtTime', 'bodyToTxt', 'bodyToSrt',
  'parseSrt', 'vttTime', 'parseVtt', 'parseTtml',
  'mergeBodies', 'splitTextByTime',
  'wavFromBuffer',
  'probeMime', 'estimateDecodedMB', 'shouldUseRecord'
];
const vars = [extractVarArray('MIXIN_TAB'), extractVarArray('hexChr'), extractVarObj('wbiCache')];
const code = 'var SETTINGS = { asrLongMode: "auto" };\n' + vars.concat(funcs.map(extractFunc)).join('\n');
const scope = new Function(code + '\n; return { md5, wbiSign, wbiQuery, getMixinKey, srtTime, bodyToTxt, bodyToSrt, parseSrt, vttTime, parseVtt, parseTtml, mergeBodies, splitTextByTime, wavFromBuffer, probeMime, estimateDecodedMB, shouldUseRecord, SETTINGS, wbiCache };')();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

console.log('== MD5 / WBI 签名 ==');
test('md5 空串', () => assert.strictEqual(scope.md5(''), 'd41d8cd98f00b204e9800998ecf8427e'));
test('md5 "abc"', () => assert.strictEqual(scope.md5('abc'), '900150983cd24fb0d6963f7d28e17f72'));
test('md5 "hello"', () => assert.strictEqual(scope.md5('hello'), '5d41402abc4b2a76b9719d911017c592'));
test('getMixinKey 长度 32', () => { const k = scope.getMixinKey('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'); assert.strictEqual(k.length, 32); });
test('wbiSign 输出 w_rid 32位hex + wts', () => {
  scope.wbiCache.img = '7cd084941338484aae1ad9425b84077c';
  scope.wbiCache.sub = '4932caff0ff746eab6f01bf08b70ac45';
  const p = scope.wbiSign({ cid: 123, bvid: 'BV1xx411c7mD', isGaiaAvoided: true });
  assert.ok(/^[0-9a-f]{32}$/.test(p.w_rid), 'w_rid 应为 32 位 hex，实际 ' + p.w_rid);
  assert.ok(typeof p.wts === 'number' && p.wts > 1000000000, 'wts 应为时间戳');
});
test('wbiQuery 可序列化', () => {
  scope.wbiCache.img = '7cd084941338484aae1ad9425b84077c';
  scope.wbiCache.sub = '4932caff0ff746eab6f01bf08b70ac45';
  const q = scope.wbiQuery({ cid: 1, bvid: 'BV1xx411c7mD' });
  assert.ok(q.includes('w_rid='), '应包含 w_rid');
  assert.ok(q.includes('wts='), '应包含 wts');
});

console.log('== 时间戳 / 导出 ==');
test('srtTime 0', () => assert.strictEqual(scope.srtTime(0), '00:00:00,000'));
test('srtTime 1小时', () => assert.strictEqual(scope.srtTime(3600), '01:00:00,000'));
test('srtTime 59分59秒999', () => assert.strictEqual(scope.srtTime(3599.999), '00:59:59,999'));
test('srtTime 进位 1.9995', () => assert.strictEqual(scope.srtTime(1.9995), '00:00:02,000'));
test('bodyToTxt', () => assert.strictEqual(scope.bodyToTxt([{ content: 'a' }, { content: 'b' }]), 'a\nb'));
test('bodyToSrt 结构', () => {
  const srt = scope.bodyToSrt([{ from: 0, to: 2, content: '你好' }]);
  assert.ok(srt.startsWith('1\n00:00:00,000 --> 00:00:02,000\n你好'), 'SRT 结构错误: ' + srt);
});

console.log('== SRT / VTT / TTML 解析 ==');
test('parseSrt 标准', () => {
  const s = '1\n00:00:01,000 --> 00:00:03,000\n第一句\n\n2\n00:00:03,000 --> 00:00:05,500\n第二句';
  const r = scope.parseSrt(s);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].from, 1); assert.strictEqual(r[0].to, 3); assert.strictEqual(r[0].content, '第一句');
  assert.strictEqual(r[1].content, '第二句');
});
test('parseVtt 标准（含标签）', () => {
  const v = 'WEBVTT\n\n00:00.000 --> 00:04.000\n<c>你好</c> 世界\n\n01:00:00.000 --> 01:00:04.500\n第二句';
  const r = scope.parseVtt(v);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].content, '你好 世界');
  assert.strictEqual(r[1].from, 3600);
});
test('parseTtml', () => {
  const t = '<transcript><text start="0" dur="2">hello</text><text start="2" dur="3">world</text></transcript>';
  // 浏览器 DOMParser 环境，Node 下跳过实际解析但验证函数存在
  assert.strictEqual(typeof scope.parseTtml, 'function');
});

console.log('== 合并 / 切分 ==');
test('mergeBodies 排序去重', () => {
  const r = scope.mergeBodies([{ body: [{ from: 5, content: 'b' }, { from: 1, content: 'a' }] }, { body: [{ from: 1, content: 'a' }] }]);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].content, 'a'); assert.strictEqual(r[1].content, 'b');
});
test('splitTextByTime 均匀分布', () => {
  const r = scope.splitTextByTime('一。二。三。', 0, 30);
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].from, 0);
  assert.strictEqual(r[2].to, 30);
});

console.log('== WAV 头生成 ==');
test('wavFromBuffer 头字段', () => {
  const fakeBuf = { sampleRate: 16000, length: 4, getChannelData: () => new Float32Array([0.5, -0.5, 0.25, -0.25]) };
  const blob = scope.wavFromBuffer(fakeBuf);
  assert.ok(blob instanceof Blob, '应返回 Blob');
  assert.ok(blob.size === 44 + 4 * 2, 'WAV 大小 = 44 + samples*2，实际 ' + blob.size);
});

console.log('== 解码兜底策略（新增 v8.1） ==');
test('probeMime WAV 魔数', () => {
  const b = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0,0,0,0]), Buffer.from('WAVE')]);
  assert.strictEqual(scope.probeMime(b), 'audio/wav');
});
test('probeMime MP4 魔数(ftyp@4)', () => {
  const b = Buffer.concat([Buffer.from([0,0,0,0x18]), Buffer.from('ftypM4A ')]);
  assert.strictEqual(scope.probeMime(b), 'audio/mp4');
});
test('probeMime WebM(EBML)', () => {
  const b = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x01]);
  assert.strictEqual(scope.probeMime(b), 'audio/webm');
});
test('probeMime Ogg', () => {
  const b = Buffer.from('OggS...');
  assert.strictEqual(scope.probeMime(b), 'audio/ogg');
});
test('probeMime ID3(MP3)', () => {
  const b = Buffer.from('ID3....');
  assert.strictEqual(scope.probeMime(b), 'audio/mpeg');
});
test('probeMime 未知数据返回 null', () => {
  const b = Buffer.from('hello world this is not audio');
  assert.strictEqual(scope.probeMime(b), null);
});
test('estimateDecodedMB 随字节增长', () => {
  const m1 = scope.estimateDecodedMB({ size: 6 * 1024 * 1024 });   // ~6MB → 数百 MB 级
  const m2 = scope.estimateDecodedMB({ size: 120 * 1024 * 1024 }); // 120MB → 数 GB 级
  assert.ok(m1 > 100 && m1 < 2000, '6MB 预估应合理，实际 ' + m1 + 'MB');
  assert.ok(m2 > m1 * 5, '120MB 预估应远大于 6MB（' + m1 + ' vs ' + m2 + '）');
});
test('shouldUseRecord: auto 小文件不录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 2 * 1024 * 1024 }), false);
});
test('shouldUseRecord: auto 超大文件(>120MB)录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 130 * 1024 * 1024 }), true);
});
test('shouldUseRecord: 强制 decode 不录制', () => {
  scope.SETTINGS.asrLongMode = 'decode';
  assert.strictEqual(scope.shouldUseRecord({ size: 500 * 1024 * 1024 }), false);
});
test('shouldUseRecord: 强制 record 录制', () => {
  scope.SETTINGS.asrLongMode = 'record';
  assert.strictEqual(scope.shouldUseRecord({ size: 1 }), true);
});

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);