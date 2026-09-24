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
  'probeMime', 'guessDuration', 'estimateDecodedMB', 'shouldUseRecord', 'probeMp4Channels',
  'listBoxes', 'parseSidx', 'toMono'
];
const vars = [
  extractVarArray('MIXIN_TAB'), extractVarArray('hexChr'), extractVarObj('wbiCache'),
  // v8.2.0 音频解码常量（顺序不能反：PCM_BYTES_PER_SEC 依赖 DECODE_RATE）
  extractVarValue('DECODE_RATE'), extractVarValue('PCM_BYTES_PER_SEC_MONO'),
  extractVarValue('PCM_BYTES_PER_SEC_STEREO'), extractVarValue('RECORD_THRESHOLD_MB')
];
const code = 'var SETTINGS = { asrLongMode: "auto" };\n' + vars.concat(funcs.map(extractFunc)).join('\n');
const scope = new Function(code + '\n; return { md5, wbiSign, wbiQuery, getMixinKey, srtTime, bodyToTxt, bodyToSrt, parseSrt, vttTime, parseVtt, ttmlTime, parseTtml, mergeBodies, splitTextByTime, wavFromBuffer, probeMime, guessDuration, estimateDecodedMB, shouldUseRecord, probeMp4Channels, listBoxes, parseSidx, toMono, DECODE_RATE, PCM_BYTES_PER_SEC_MONO, PCM_BYTES_PER_SEC_STEREO, RECORD_THRESHOLD_MB, SETTINGS, wbiCache };')();

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
test('estimateDecodedMB: 单声道按 64KB/s（3H 约 659MB）', () => {
  // 10800s × 16000 × 4B = 691200000B ≈ 659MB
  const m = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800, 1);
  assert.ok(m > 600 && m < 700, '3H 单声道应估约 659MB，实际 ' + m + 'MB');
});
test('estimateDecodedMB: 立体声按 128KB/s（3H 约 1318MB）——decodeAudioData 不降声道', () => {
  // decodeAudioData 只重采样、不降混，立体声源解出来仍是 2 声道，估算必须按双倍算，否则低估撞 OOM
  const m = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800, 2);
  assert.ok(m > 1250 && m < 1400, '3H 立体声应估约 1318MB，实际 ' + m + 'MB');
});
test('estimateDecodedMB: 声道未知时按立体声保守算（宁可高估）', () => {
  const known = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800, 1);
  const unknown = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800);
  assert.strictEqual(unknown, known * 2, '未知声道应按立体声（单声道的两倍）估');
});
test('estimateDecodedMB: 没有真实时长时退回按码率猜（保守取 64kbps）', () => {
  const m = scope.estimateDecodedMB({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 0, 1);
  assert.ok(m > 600 && m < 750, '86MB 无元数据单声道应估约 687MB，实际 ' + m + 'MB');
});
test('estimateDecodedMB 随字节单调增长', () => {
  const m1 = scope.estimateDecodedMB({ size: 6 * 1024 * 1024 });
  const m2 = scope.estimateDecodedMB({ size: 120 * 1024 * 1024 });
  assert.ok(m2 > m1 * 5, '120MB 预估应远大于 6MB（' + m1 + ' vs ' + m2 + '）');
});
test('shouldUseRecord: 3H 单声道 → 走解码快路（659MB < 800MB）', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  // v8.2.0 核心收益：解码目标改 16000 后单声道 3 小时只占约 659MB，走「直接解码切片」快路，几十秒出结果
  assert.strictEqual(scope.shouldUseRecord({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800, 1), false);
});
test('shouldUseRecord: 3H 立体声 → 走播放录制（1318MB > 800MB，防 OOM 崩页）', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800, 2), true);
});
test('shouldUseRecord: 声道未知按立体声保守处理 → 走播放录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 86 * 1024 * 1024, type: 'audio/mp4' }, 10800), true);
});
test('shouldUseRecord: 10 小时单声道 → 超 800MB 阈值，走录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  // 36000s × 64KB/s ≈ 2197MB > 800MB
  assert.strictEqual(scope.shouldUseRecord({ size: 280 * 1024 * 1024, type: 'audio/mp4' }, 36000, 1), true);
});
test('shouldUseRecord: 源文件 ≥300MB 硬保险走录制', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 300 * 1024 * 1024, type: 'audio/mp4' }, 600), true);
});
test('shouldUseRecord: 小文件安全解码', () => {
  scope.SETTINGS.asrLongMode = 'auto';
  assert.strictEqual(scope.shouldUseRecord({ size: 10 * 1024 * 1024, type: 'audio/mp4' }, 1300, 2), false);
});
test('PCM 常量：解码目标 16000，单声道 64000 B/s、立体声 128000 B/s', () => {
  assert.strictEqual(scope.DECODE_RATE, 16000);
  assert.strictEqual(scope.PCM_BYTES_PER_SEC_MONO, 64000);
  assert.strictEqual(scope.PCM_BYTES_PER_SEC_STEREO, 128000);
  assert.strictEqual(scope.RECORD_THRESHOLD_MB, 800);
});
test('probeMp4Channels: 能从 stsd > mp4a 里读出声道数', () => {
  // 手工拼一个最小 MP4：moov > trak > mdia > minf > stbl > stsd > mp4a(channelcount=1)
  const audioEntry = Buffer.alloc(36);
  audioEntry.write('mp4a', 4, 'ascii');
  audioEntry.writeUInt16BE(1, 8 + 16);   // channelcount = 1
  const stsdBody = Buffer.alloc(8 + audioEntry.length);
  stsdBody.writeUInt32BE(1, 4);          // entry_count = 1
  audioEntry.copy(stsdBody, 8);
  function box(type, body) {
    const b = Buffer.alloc(8 + body.length);
    b.writeUInt32BE(8 + body.length, 0);
    b.write(type, 4, 'ascii');
    body.copy(b, 8);
    return b;
  }
  const mp4 = box('moov', box('trak', box('mdia', box('minf', box('stbl', box('stsd', stsdBody))))));
  assert.strictEqual(scope.probeMp4Channels(mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.length)), 1);
});
test('probeMp4Channels: 拿不到就返回 0（调用方按立体声保守算）', () => {
  const junk = Buffer.from('this is definitely not an mp4 file at all');
  assert.strictEqual(scope.probeMp4Channels(junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.length)), 0);
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
  assert.ok(/shouldUseRecord\(blob, state\.audioDurSec, state\.audioCh\)/.test(fn), 'shouldUseRecord 应带真实时长与声道数');
  assert.ok(/await probeAudioChannels\(blob\)/.test(fn), 'runAsr 应调用 probeAudioChannels 探测声道');
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

console.log('== v8.2.1 审查修复回归（切视频重置 / 进度单调 / 对账 / flush / 静音回退）==');
test('切视频必须重置音频时长与声道，避免沿用上一条视频', () => {
  const fn = extractFunc('resetForNewVideo');
  assert.ok(/state\.audioDurSec = 0/.test(fn), 'resetForNewVideo 应重置 audioDurSec');
  assert.ok(/state\.audioCh = 0/.test(fn), 'resetForNewVideo 应重置 audioCh');
});
test('进度条加单调保护（降级路径不倒退）', () => {
  const fn = extractFunc('render');
  assert.ok(/a\._pct/.test(fn), 'render 应有 _pct 单调保护');
  assert.ok(/if \(a\._pct != null && pct < a\._pct\) pct = a\._pct;/.test(fn), '单调保护写法应如预期');
});
test('时间轴对账只在确实播到结尾时做，半截收尾标记不完整', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/playedToEnd/.test(fn), '应有 playedToEnd 标记');
  assert.ok(/segsAll\.incomplete = true/.test(fn), '提前收尾应标记 incomplete');
  assert.ok(/naturalEnd && playedToEnd && segsAll\.length/.test(fn), '对账条件应同时要求 playedToEnd');
});
test('不完整标记从录制路传递到最终结果', () => {
  const fn = extractFunc('runAsr');
  assert.ok(/merged\.incomplete = !!\(body && body\.incomplete\)/.test(fn), 'runAsr 应把录制路的 incomplete 传下去');
});
test('AudioContext suspended 时先 resume（否则一个采样点都收不到）', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/ctx\.state === 'suspended'/.test(fn), '应检查 ctx.state');
  assert.ok(/await ctx\.resume\(\)/.test(fn), '应调用 ctx.resume()');
});
test('背压复位抽成 maybeResume，小切片 continue 前也调用（堵死锁）', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/function maybeResume\(\)/.test(fn), '应抽出 maybeResume');
  assert.ok(/\{ maybeResume\(\); continue; \}/.test(fn), '跳过小切片前也要复位背压');
  assert.ok(!/try \{ audio\.play\(\); \} catch/.test(fn), 'play() 的 Promise 必须用 .catch 接住，try/catch 抓不到异步拒绝');
});
test('回退到 captureStream 时显式关掉元素音量（那条路图内静音管不到）', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/audio\.volume = 0/.test(fn), '回退分支应设 audio.volume = 0');
});
test('AudioWorklet 收尾 flush 未满缓冲，并回收 Blob URL', () => {
  const fn = extractFunc('recorderAsr');
  assert.ok(/port\.postMessage\(\{ flush: true \}\)/.test(fn), '收尾应发 flush 消息');
  assert.ok(/finally \{ try \{ URL\.revokeObjectURL\(wUrl\)/.test(fn), 'Blob URL 应在 finally 里回收');
  assert.ok(/if \(e\.data && e\.data\.flush/.test(src), 'worklet 侧应处理 flush 消息');
});
test('MIME 自愈不再依赖被 detach 的 buffer', () => {
  const fn = extractFunc('decodeAudio');
  assert.ok(/head = buf\.slice\(0, 16\)/.test(fn), '应先留头字节');
  assert.ok(/blob\.arrayBuffer\(\)\.then\(function \(buf2\)/.test(fn), '重试应重新读 buffer');
  assert.ok(!/var fixed = new Blob/.test(fn), '没用的 fixed 变量应删掉');
});
test('胶囊与悬浮按钮二选一显示，不再互相遮挡', () => {
  const fn = extractFunc('render');
  assert.ok(/classList\.contains\('show'\)/.test(fn), 'render 应判断面板是否展开');
});

console.log('== v9.0 分段解码（分片目录解析 / 顶盒遍历）==');
test('parseSidx: 从分片目录读出片数、时长与字节大小', () => {
  const timescale = 48000;
  const refs = [
    { size: 43091, dur: 240480 },   // 5.01 秒
    { size: 41231, dur: 240480 },
    { size: 40999, dur: 240480 }
  ];
  const body = Buffer.alloc(24 + refs.length * 12);
  body.writeUInt8(0, 0);            // version = 0
  body.writeUInt32BE(1, 4);         // reference_ID
  body.writeUInt32BE(timescale, 8);
  body.writeUInt32BE(0, 12);        // earliest_presentation_time
  body.writeUInt32BE(0, 16);        // first_offset
  body.writeUInt16BE(refs.length, 22);
  let p = 24;
  refs.forEach((r) => {
    body.writeUInt32BE(r.size, p); p += 4;
    body.writeUInt32BE(r.dur, p); p += 4;
    body.writeUInt32BE(0, p); p += 4;
  });
  const box = Buffer.alloc(8 + body.length);
  box.writeUInt32BE(8 + body.length, 0);
  box.write('sidx', 4, 'ascii');
  body.copy(box, 8);
  const ab = box.buffer.slice(box.byteOffset, box.byteOffset + box.length);
  const s = scope.parseSidx(ab, 0);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.timescale, 48000);
  assert.strictEqual(s.list[0].size, 43091);
  assert.ok(Math.abs(s.list[0].durSec - 5.01) < 0.01, '单片时长应约 5.01 秒，实际 ' + s.list[0].durSec);
  assert.ok(Math.abs(s.list[1].startSec - 5.01) < 0.01, '第二片起点应接着第一片');
  assert.ok(Math.abs(s.totalSec - 15.03) < 0.05, '总时长应约 15 秒，实际 ' + s.totalSec);
});
test('listBoxes: 按顺序列出顶层盒子并给出字节偏移', () => {
  function mkbox(type, len) { const b = Buffer.alloc(8 + len); b.writeUInt32BE(8 + len, 0); b.write(type, 4, 'ascii'); return b; }
  const mp4 = Buffer.concat([mkbox('ftyp', 24), mkbox('moov', 100), mkbox('sidx', 20), mkbox('moof', 8), mkbox('mdat', 40)]);
  const ab = mp4.buffer.slice(mp4.byteOffset, mp4.byteOffset + mp4.length);
  const list = scope.listBoxes(ab);
  assert.strictEqual(list.map((x) => x.type).join(','), 'ftyp,moov,sidx,moof,mdat');
  assert.strictEqual(list[2].off, 32 + 108, 'sidx 起点应为前两个盒子长度之和');
});
test('toMono: 立体声取左右平均，单声道原样拼接', () => {
  function fakeBuf(chans) {
    return { length: 2, numberOfChannels: chans.length, getChannelData: (i) => chans[i] };
  }
  const stereo = scope.toMono([fakeBuf([new Float32Array([1, 0]), new Float32Array([0, 1])])]);
  assert.strictEqual(stereo[0], 0.5);
  assert.strictEqual(stereo[1], 0.5);
  // Float32 存 0.4 会变成 0.40000000596…，必须用近似比较
  const mono = scope.toMono([fakeBuf([new Float32Array([0.2, 0.4])])]);
  assert.ok(Math.abs(mono[1] - 0.4) < 1e-6, '单声道应原样拼过来，实际 ' + mono[1]);
});
test('runAsr 里分段路排在最前，且失败会回落（不能一条路堵死）', () => {
  const fn = extractFunc('runAsr');
  assert.ok(/await probeSegments\(audioUrl\)/.test(fn), 'runAsr 应调用 probeSegments');
  assert.ok(/segBody = await segmentAsr\(/.test(fn), 'runAsr 应调用 segmentAsr');
  assert.ok(/catch \(eSeg\)/.test(fn), '分段路失败应被捕获后回落');
  assert.ok(/SETTINGS\.asrLongMode !== 'record'/.test(fn), '用户强制播放录制时应跳过分段路');
});
test('分段解码按 Range 请求分片，并使用 arraybuffer 接收', () => {
  const fn = extractFunc('fetchRange');
  assert.ok(/'Range': 'bytes=' \+ start \+ '-' \+ end/.test(fn), '应带 Range 头');
  assert.ok(/responseType: 'arraybuffer'/.test(fn), '应以 arraybuffer 接收');
  assert.ok(/r\.status === 206/.test(fn), '应接受 206 部分内容');
});
test('分段解码的批次上限常量合理（控制内存与调用次数）', () => {
  const fn = extractFunc('segmentAsr');
  assert.ok(/SEG_BATCH_SEC/.test(fn), '应按批攒够 SEG_BATCH_SEC 秒再送识别');
  assert.ok(/SEG_CONCURRENCY/.test(fn), '应并发下载分片');
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