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
function extractVarValue(name) {
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;'));
  if (!m) throw new Error('未找到变量 ' + name);
  return m[0];
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
  'parseSrt', 'vttTime', 'parseVtt', 'ttmlTime', 'parseTtml',
  'mergeBodies', 'splitTextByTime',
  'wavFromBuffer',
  'probeMime', 'guessDuration', 'estimateDecodedMB', 'shouldUseRecord'
];
const vars = [
  extractVarArray('MIXIN_TAB'), extractVarArray('hexChr'), extractVarObj('wbiCache'),
  // v8.2.0 音频解码常量（顺序不能反：PCM_BYTES_PER_SEC 依赖 DECODE_RATE）
  extractVarValue('DECODE_RATE'), extractVarValue('PCM_BYTES_PER_SEC'), extractVarValue('RECORD_THRESHOLD_MB')
];
const code = 'var SETTINGS = { asrLongMode: "auto" };\n' + vars.concat(funcs.map(extractFunc)).join('\n');
const scope = new Function(code + '\n; return { md5, wbiSign, wbiQuery, getMixinKey, srtTime, bodyToTxt, bodyToSrt, parseSrt, vttTime, parseVtt, ttmlTime, parseTtml, mergeBodies, splitTextByTime, wavFromBuffer, probeMime, guessDuration, estimateDecodedMB, shouldUseRecord, DECODE_RATE, PCM_BYTES_PER_SEC, RECORD_THRESHOLD_MB, SETTINGS, wbiCache };')();

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
test('vttTime 逗号毫秒（SRT 型 track）', () => {
  assert.strictEqual(scope.vttTime('00:00:01,500'), 1.5);
  assert.strictEqual(scope.vttTime('00:00:01.500'), 1.5);
});
test('parseTtml text+start/dur 形态', () => {
  const t = '<transcript><text start="0" dur="2">hello</text><text start="2" dur="3">world</text></transcript>';
  const r = scope.parseTtml(t);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].from, 0); assert.strictEqual(r[0].to, 2); assert.strictEqual(r[0].content, 'hello');
  assert.strictEqual(r[1].from, 2);
});
test('parseTtml YouTube <p begin/end> 形态', () => {
  const t = '<tt><body><div><p begin="00:00:01.500" end="00:00:04.000">Hello &amp; world</p><p begin="00:00:04.000" end="00:00:05.250">Second<br/>line</p></div></body></tt>';
  const r = scope.parseTtml(t);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].from, 1.5); assert.strictEqual(r[0].to, 4); assert.strictEqual(r[0].content, 'Hello & world');
  assert.strictEqual(r[1].from, 4); assert.strictEqual(r[1].content, 'Second\nline');
});
test('ttmlTime 两种格式', () => {
  assert.strictEqual(scope.ttmlTime('00:01:02,500'), 62.5);
  assert.strictEqual(scope.ttmlTime('00:01:02.500'), 62.5);
  assert.strictEqual(scope.ttmlTime('7.25'), 7.25);
  assert.strictEqual(scope.ttmlTime(''), 0);
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
test('estimateDecodedMB: 有真实时长时按 16kHz 单声道 64KB/s 算', () => {
  // 10800 秒（3 小时）× 16000 采样 × 4 字节 = 691200000 字节 ≈ 659MB
  const m = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800);
  assert.ok(m > 600 && m < 700, '3H 有真实时长应估约 659MB，实际 ' + m + 'MB');
});
test('estimateDecodedMB: 没有真实时长时退回按码率猜（保守取 64kbps）', () => {
  // 86MB ÷ 8000B/s = 11264s；11264 × 64000B ÷ 1MB ≈ 687MB
  const m = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' });
  assert.ok(m > 600 && m < 750, '86MB 无元数据应估约 687MB，实际 ' + m + 'MB');
});
test('estimateDecodedMB 随字节单调增长', () => {
  const m1 = scope.estimateDecodedMB({ size: 6 * 1024 * 1024 });
  const m2 = scope.estimateDecodedMB({ size: 120 * 1024 * 1024 });
  assert.ok(m2 > m1 * 5, '120MB 预估应远大于 6MB（' + m1 + ' vs ' + m2 + '）');
});
test('shouldUseRecord: 3H 有真实时长 10800s → 走解码快路（不录制）', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  // v8.2.0 核心收益：解码目标改 16000 单声道后，3 小时音频只占约 659MB < 800MB 阈值，
  // 于是 3H 可以走「直接解码切片」的快路（几十秒），不必再真放 13 分钟
  assert.strictEqual(scope.shouldUseRecord({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800), false);
});
test('shouldUseRecord: 3H 拿不到真实时长也能走解码（保守估仍 < 800MB）', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  // 无元数据时按 64kbps 保守估：86MB → 11264s → 约 687MB < 800MB
  // 这个保守方向是安全的：真实码率越高、真实时长越短，占的内存只会更小
  assert.strictEqual(scope.shouldUseRecord({ size: 86 * 1024 * 1024, type: 'audio/mp4' }), false);
});
test('shouldUseRecord: 10 小时真实时长 → 超 800MB 阈值，走录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  // 36000s × 64KB/s ≈ 2197MB > 800MB
  assert.strictEqual(scope.shouldUseRecord({ size: 280 * 1024 * 1024, type: 'audio/mp4' }, 36000), true);
});
test('shouldUseRecord: 源文件 ≥300MB 硬保险走录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 300 * 1024 * 1024, type: 'audio/mp4' }, 600), true);
});
test('shouldUseRecord: 小文件安全解码', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 10 * 1024 * 1024, type: 'audio/mp4' }, 1300), false);
});
test('PCM 常量：解码目标 16000 单声道，每秒 64000 字节', () => {
  assert.strictEqual(scope.DECODE_RATE, 16000);
  assert.strictEqual(scope.PCM_BYTES_PER_SEC, 64000);
  assert.strictEqual(scope.RECORD_THRESHOLD_MB, 800);
});
test('shouldUseRecord: 强制 decode 不录制', () => {
  scope.SETTINGS.asrLongMode = 'decode';
  assert.strictEqual(scope.shouldUseRecord({ size: 500 * 1024 * 1024 }), false);
});
test('shouldUseRecord: 强制 record 录制', () => {
  scope.SETTINGS.asrLongMode = 'record';
  assert.strictEqual(scope.shouldUseRecord({ size: 1 }), true);
});

console.log('== v8.2.0 长音频硬化（静音 / 不丢帧 / 不误判 / 背压 / 进度）==');
test('decodeAudio 解码目标改成 16000 单声道（内存省 5.5 倍）', () => {
  const fn = extractFunc('decodeAudio');
  assert.ok(/new Ctx\(1, 1, DECODE_RATE\)/.test(fn), '解码上下文应为 new Ctx(1, 1, DECODE_RATE)');
  assert.ok(!/44100/.test(fn), 'decodeAudio 里不应再出现 44100');
});
test('probeAudioMeta 只读元数据且静音（不会出声）', () => {
  const fn = extractFunc('probeAudioMeta');
  assert.ok(/preload\s*=\s*'metadata'/.test(fn), '应以 preload=metadata 只读元数据');
  assert.ok(/muted\s*=\s*true/.test(fn), '应设 muted=true 防止出声');
});
test('runAsr 下载后探测真实时长再选路', () => {
  const fn = extractFunc('runAsr');
  assert.ok(/await probeAudioMeta\(blob\)/.test(fn), 'runAsr 应调用 probeAudioMeta');
  assert.ok(/shouldUseRecord\(blob, state\.audioDurSec\)/.test(fn), 'shouldUseRecord 应带真实时长参数');
});
test('播放全程静音：增益节点设 0', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/muteNode\.gain\.value\s*=\s*0/.test(fn), '静音节点增益应为 0');
  assert.ok(/createMediaElementSource/.test(fn), '应用 createMediaElementSource 接管音频输出');
});
test('抓音通道优先 AudioWorklet，保留 ScriptProcessor 回退', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/audioWorklet\.addModule/.test(fn), '应加载 AudioWorklet');
  assert.ok(/createScriptProcessor/.test(fn), '应保留 ScriptProcessor 回退分支');
  assert.ok(/if \(!tapReady\)/.test(fn), '回退分支应以 tapReady 判定');
});
test('AudioWorklet 处理器源码内联（保持单文件脚本）', () => {
  assert.ok(/var WORKLET_SRC = \[/.test(src), '应内联 WORKLET_SRC 字符串数组');
  assert.ok(/registerProcessor\("bsr-tap"/.test(src), '应注册 bsr-tap 处理器');
});
test('停滞判定看缓冲状态，不再 5 秒误判收工', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/audio\.buffered/.test(fn), '停滞判定应读 audio.buffered');
  assert.ok(/stallN >= 80/.test(fn), '应收紧到 80 次（20 秒）才判定收尾');
  assert.ok(!/stallN >= 20/.test(fn), '不应保留旧的 20 次（5 秒）误判阈值');
});
test('背压：切片积压时暂停播放，降下来再继续', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/pauseGate/.test(fn), '应存在背压闸门 pauseGate');
  assert.ok(/pending\.length >= 3/.test(fn), '积压 ≥3 片应触发暂停');
  assert.ok(/if \(pauseGate\) return;/.test(fn), '背压暂停不应被「意外暂停自动恢复」打断');
});
test('五阶段进度：download / probe / decode / record / transcribe / merge', () => {
  const fn = extractFunc('runAsr');
  ['download', 'probe', 'decode', 'transcribe', 'merge'].forEach(function (st) {
    assert.ok(new RegExp("stage = '" + st + "'").test(fn), 'runAsr 应设置 stage=' + st);
  });
  const rf = extractFunc('recorderAsr');
  assert.ok(/stage = 'record'/.test(rf), 'recorderAsr 应设置 stage=record');
});
test('实时字幕流：转写过程持续回填 preview', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/state\.asr\.preview = segsAll\.slice\(-40\)/.test(fn), '录制路应回填 preview');
  const rf = extractFunc('runAsr');
  assert.ok(/state\.asr\.preview = body\.slice\(-40\)/.test(rf), '分片路应回填 preview');
});
test('转写完成发系统通知（GM_notification）', () => {
  assert.ok(/@grant\s+GM_notification/.test(src), '头部应声明 @grant GM_notification');
  const fn = extractFunc('notifyDone');
  assert.ok(/GM_notification\(/.test(fn), 'notifyDone 应调用 GM_notification');
});
test('总进度按阶段权重折算（下载20/解码45/转写95/合并100）', () => {
  const fn = extractFunc('render');
  assert.ok(/return \[0, 20\]/.test(fn), '下载段应占 0-20');
  assert.ok(/return \[45, 95\]/.test(fn), '转写段应占 45-95');
  assert.ok(/return \[95, 100\]/.test(fn), '合并段应占 95-100');
});

console.log('== 多 P 视频切 P 字幕刷新（v8.1.8 回归）==');
test('fetchBody 缓存 key 以 cid 优先（多 P 不串台）', () => {
  const fn = extractFunc('fetchBody');
  assert.ok(/var\s+key\s*=\s*\(state\.cid\s*\|\|/.test(fn), '缓存 key 应以 state.cid 优先，实际：' + fn.split('\n')[0]);
});
test('getSubtitles 捕获世代号 myGen', () => {
  const fn = extractFunc('getSubtitles');
  assert.ok(/var\s+myGen\s*=\s*asrGen\s*;/.test(fn), 'getSubtitles 应在入口捕获 myGen = asrGen');
});
test('getSubtitles 每个 await 后都有 asrStop 守卫（≥4 处）', () => {
  const fn = extractFunc('getSubtitles');
  const n = (fn.match(/asrStop\(myGen\)/g) || []).length;
  assert.ok(n >= 4, 'asrStop 守卫应 ≥4 处（resolve/fetchSubs/fetchBody/translateBody/catch），实际 ' + n + ' 处');
});
test('getSubtitles 守卫触发时直接 return（旧结果不写回）', () => {
  const fn = extractFunc('getSubtitles');
  assert.ok(/if\s*\(asrStop\(myGen\)\)\s*return;/.test(fn), '守卫应形如 if (asrStop(myGen)) return;');
});

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败');
process.exit(failed ? 1 : 0);