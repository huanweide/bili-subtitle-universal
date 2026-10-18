'use strict';
/**
 * 本次「吞失败 / 谎报成功 / 误导白烧额度」修复的行为验证。
 *
 * 与 tests/run-tests.js 同一套路：从 bili-subtitle.user.js 真实源码里按名字抠函数出来跑，
 * 不另抄一份实现——抄一份就会和实现漂移，验证了假的。
 *
 * 运行：node scripts/verify/verify-fix.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bili-subtitle.user.js'), 'utf8');

// 缩进法而不是数花括号：extractAsrText 里有字符串字面量 '{'，
// 数括号会把它算成一层，一路数到文件尾（tests/run-tests.js 也踩过这个坑）。
// IIFE 里的顶层函数统一收在「换行 + 两空格 + }」上，内层块是四空格，不会误命中。
function extractFunc(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(SRC);
  if (!m) throw new Error('未找到函数 ' + name);
  const tail = SRC.slice(m.index).match(/\n {2}\}/);
  if (!tail) throw new Error('找不到函数 ' + name + ' 的结束');
  return SRC.slice(m.index, m.index + tail.index + tail[0].length);
}
function extractVarObj(name) {
  const m = SRC.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\{[\\s\\S]*?\\n  \\};'));
  if (m) return m[0];
  const m2 = SRC.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\{[\\s\\S]*?\\};'));
  if (!m2) throw new Error('未找到对象变量 ' + name);
  return m2[0];
}

const code = [
  'var asrEstTs = false;',
  (SRC.match(/var\s+SRT_TS\s*=\s*[^;]+;/) || [''])[0],
  'var SETTINGS = { aiProvider: "siliconflow", aiBase: "", aiAudioEp: "", asrModel: "", asrLang: "auto" };',
  extractVarObj('AI_PROVIDERS'),
  extractFunc('unescapeEntities'),
  extractFunc('parseSrt'),
  extractFunc('splitTextByTime'),
  extractFunc('ttmlTime'),
  extractFunc('parseTtml'),
  extractFunc('extractAsrText'),
  extractFunc('asrToSegments'),
  extractFunc('currentProvider'),
  extractFunc('aiBaseUrl'),
  extractFunc('aiEndpointPath'),
  extractFunc('aiUrl')
].join('\n');

const S = new Function(code + '\n; return { SETTINGS, AI_PROVIDERS, parseSrt, parseTtml, extractAsrText, asrToSegments, aiUrl, aiEndpointPath, flag: function () { return asrEstTs; }, reset: function () { asrEstTs = false; } };')();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' —— ' + detail : '')); }
}
function throws(name, fn, needle) {
  let threw = '', got = false;
  try { fn(); } catch (e) { got = true; threw = String(e && e.message || e); }
  ok(name, got && (!needle || threw.indexOf(needle) >= 0), got ? ('错误信息：' + threw) : '没有抛错');
}

console.log('== P0-A 转写响应不再伪造时间戳 ==');
S.reset();
const jsonResp = '{"text":"第一句。第二句。第三句。","usage":{"seconds":9.2}}';
let segs = S.asrToSegments(jsonResp, 0, 30);
ok('硅基流动式 JSON 响应能剥出文字（不再是 0 句）', segs.length === 3, '实际 ' + segs.length + ' 句');
ok('剥出的文字是接口原文，不是 JSON 字符串本身',
  segs[0] && segs[0].content === '第一句。', '实际 ' + JSON.stringify(segs[0] && segs[0].content));
ok('JSON 响应（无时间戳）被如实标记为估算时间轴', S.flag() === true);
ok('估算时间戳落在该片真实时间窗内', segs[0].from >= 0 && segs[segs.length - 1].to <= 30.0001,
  JSON.stringify(segs.map((s) => [s.from, s.to])));

S.reset();
const srtResp = '1\n00:00:01,000 --> 00:00:02,500\n真的 SRT\n';
segs = S.asrToSegments(srtResp, 0, 30);
ok('真 SRT 响应走解析路（1 句，时间戳 1.0~2.5）',
  segs.length === 1 && Math.abs(segs[0].from - 1) < 1e-6 && Math.abs(segs[0].to - 2.5) < 1e-6,
  JSON.stringify(segs));
ok('真 SRT 不标记估算', S.flag() === false);

S.reset();
segs = S.asrToSegments('{"text":"裸文本兜底"}', 0, 10);
ok('data.text 之外的 JSON 字段也认（text）', segs.length >= 1);

console.log('\n== P0-A 认不出的响应必须报错，不许静默铺伪时间戳 ==');
S.reset();
throws('空响应 "" → 报错', () => S.asrToSegments('', 0, 30), '响应无法识别');
throws('纯噪声 JSON（没有文本字段）→ 报错', () => S.asrToSegments('{"foo":1}', 0, 30), '响应无法识别');
throws('非法 JSON → 报错', () => S.asrToSegments('{"text": "缺个括号"', 0, 30), '响应无法识别');
throws('接口 error 体 → 报出接口给的原因',
  () => S.asrToSegments('{"error":{"message":"model not found"}}', 0, 30), 'ASR 接口错误');
ok('报错路径一条都没生成字幕段（不是先吐段再报错）', (function () {
  try { S.asrToSegments('{"foo":1}', 0, 30); return false; } catch (e) { return true; }
})());
// 「这段是纯音乐」也是正经结果：跳过，不许拿空串铺出一句空白字幕
ok('{"text":""}（静音段）→ 0 段且不报错，不铺空白句', (function () {
  var r = S.asrToSegments('{"text":""}', 0, 30);
  return r.length === 0;
})());

console.log('\n== P0-B / P0-C / P1.3 / P2.4 厂商预设 ==');
const P = S.AI_PROVIDERS;
ok('硅基流动不再给出官方不存在的 SenseVoiceLarge',
  P.siliconflow.asrModels.indexOf('FunAudioLLM/SenseVoiceLarge') < 0
  && P.siliconflow.asrModels.indexOf('FunAudioLLM/SenseVoiceSmall') >= 0,
  JSON.stringify(P.siliconflow.asrModels));
ok('OpenRouter 标记为支持语音转写 + 有音频端点',
  P.openrouter.supportsAudio === true && P.openrouter.audio === '/audio/transcriptions',
  'audio=' + P.openrouter.audio + ' supportsAudio=' + P.openrouter.supportsAudio);
ok('OpenRouter 给了 STT 模型清单', (P.openrouter.asrModels || []).length >= 1, JSON.stringify(P.openrouter.asrModels));
ok('OpenRouter 已下线的 claude-3.5-haiku / gemini-flash-1.5 已换掉',
  P.openrouter.chatModels.indexOf('anthropic/claude-3.5-haiku') < 0
  && P.openrouter.chatModels.indexOf('google/gemini-flash-1.5') < 0,
  JSON.stringify(P.openrouter.chatModels));
ok('DeepSeek 的 deepseek-chat / deepseek-reasoner 保留不动（官方长期别名，别臆断删）',
  P.deepseek.chatModels.indexOf('deepseek-chat') >= 0 && P.deepseek.chatModels.indexOf('deepseek-reasoner') >= 0,
  JSON.stringify(P.deepseek.chatModels));
ok('response_format 只在 OpenAI whisper 系列下才发',
  /if \(SETTINGS\.aiProvider === 'openai' && \/\^whisper\/i\.test\(SETTINGS\.asrModel \|\| ''\)\) fd\.append\('response_format', 'srt'\);/.test(SRC));
ok('热词降级正则不再含泛化的 param|invalid（否则「模型名无效」会被误判成热词问题）',
  /hotwords\.length && r\.status >= 400 && r\.status < 500 &&\s+\/hotword\|热词\|unsupported\/i/.test(SRC)
  && !/hotword\|热词\|parameter\|param\|unsupported\|invalid/i.test(SRC));

console.log('\n== P1.6 自定义厂商 URL 拼接 ==');
S.SETTINGS.aiProvider = 'custom'; S.SETTINGS.aiBase = ''; S.SETTINGS.aiAudioEp = '';
throws('根地址留空 → 明确报错（不再拼出打到当前页面域名的相对路径）',
  () => S.aiUrl('chat'), 'API 根地址');
S.SETTINGS.aiBase = 'https://my-host/v1';
ok('填了根地址 → 正常拼', S.aiUrl('audio') === 'https://my-host/v1/audio/transcriptions', S.aiUrl('audio'));
S.SETTINGS.aiAudioEp = 'https://other-host/asr';
ok('音频端点填完整 URL → 直接用它，不再拼成 https://my-host/v1/https://other-host/asr',
  S.aiUrl('audio') === 'https://other-host/asr', S.aiUrl('audio'));
S.SETTINGS.aiAudioEp = ''; S.SETTINGS.aiProvider = 'openai';
ok('内置厂商仍走预设端点',
  S.aiUrl('audio') === 'https://api.openai.com/v1/audio/transcriptions', S.aiUrl('audio'));

console.log('\n== P1.8 TTML 注释 / head 不再当字幕 ==');
const ttml = '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml">' +
  '<head><p begin="00:00:00.000" end="00:00:01.000">head 里的样式说明</p></head>' +
  '<body><div>' +
  '<!-- <p begin="00:00:00.000" end="00:00:09.000">注释里的假字幕</p> -->' +
  '<p begin="00:00:01.000" end="00:00:02.000">真字幕</p>' +
  '</div></body></tt>';
const t = S.parseTtml(ttml);
ok('只解析出 1 句（head 的 p 与注释里的 p 都被排除）', t.length === 1, '实际 ' + t.length + ' 句：' + JSON.stringify(t.map((x) => x.content)));
ok('内容是真字幕', t[0] && t[0].content === '真字幕', JSON.stringify(t[0] && t[0].content));

console.log('\n== 源码级静态核对（其余各条） ==');
ok('单次直传上限改成 25MB（对齐 OpenAI/OpenRouter 官方限制）',
  /var MAX_SINGLE = 25 \* 1024 \* 1024;/.test(SRC) && !/40 \* 1024 \* 1024/.test(SRC));
ok('WBI 以 wbi_img/wbi_sub 是否存在为准，不再硬性要求 code===0',
  /if \(!d \|\| !d\.data \|\| !d\.data\.wbi_img \|\| !d\.data\.wbi_img\.img_url \|\| !d\.data\.wbi_img\.sub_url\)/.test(SRC)
  && !/if \(d\.code !== 0 \|\| !d\.data \|\| !d\.data\.wbi_img/.test(SRC));
ok('YouTube resolve 读取 playabilityStatus.status / reason',
  /playabilityStatus/.test(SRC) && /state\.ytBlocked =/.test(SRC) && /YouTube 拒绝播放/.test(SRC));
ok('ytBlocked 卡在 AI 转写引导之前',
  /if \(state\.ytBlocked\) \{\s+state\.err = state\.ytBlocked; state\.loading = false; render\(\); return;/.test(SRC));
ok('B 站 need_login_subtitle 已读取并给出「需登录」提示',
  /need_login_subtitle/.test(SRC) && /该视频字幕需登录后可见/.test(SRC));
ok('4xx 不再被 ASR 回退吞掉', /var hardFail = \/HTTP\\s\+4\\d\\d\//.test(SRC) && /!hardFail/.test(SRC));
ok('YouTube 直接跳过 ASR 回退（它没有音频可转）', /var canAsr = state\.adapter && state\.adapter\.id !== 'youtube'/.test(SRC));
ok('YouTube 无字幕文案已按站点区分（不再喊「点 AI 转写」）',
  /state\.adapter\.id === 'youtube'\)\s*\? 'ℹ️ 该 YouTube 视频没有字幕轨道/.test(SRC));
ok('aiChat 带 max_tokens 并检查 finish_reason=length',
  /max_tokens: 8192/.test(SRC) && /finish_reason === 'length'/.test(SRC));
ok('换厂商时重置模型输入框的值（applyProviderDefaults）',
  /function applyProviderDefaults\(\)/.test(SRC) && /applyProviderDefaults\(\);/.test(SRC));
ok('导出按钮只在有字幕时显示（AI 转写/取消/解锁不受影响）',
  /var exportIds = \['#bsrCopy'/.test(SRC) && /eb\.style\.display = state\.body \? '' : 'none'/.test(SRC));
ok('死 CSS 已清（.bsr-wbox/.bsr-wval/.bsr-wpresets/.bsr-wpreset-tip/.bsr-res-r 全无引用）',
  !/bsr-wbox|bsr-wval|bsr-wpresets|bsr-wpreset-tip|bsr-res-r/.test(SRC));
ok('撒谎注释已改（不再声称「第一次点展开评分理由」）',
  !/第一次点展开评分理由/.test(SRC) && !/用户点开「评分理由」时/.test(SRC));

console.log('----------------------------------------');
console.log(fail === 0 ? ('PASS ' + pass + '/' + pass) : ('FAIL ' + fail + ' 项（共 ' + (pass + fail) + '）'));
process.exit(fail === 0 ? 0 : 1);
