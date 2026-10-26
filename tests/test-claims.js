'use strict';

/**
 * tests/test-claims.js — 全功能验证矩阵：README 承诺的每一条，源码里都得有证据
 *
 * 怎么跑：
 *   node tests/test-claims.js
 *
 * 为什么需要它：本项目的 README 宣传面很广（三站字幕 / 四层转写 / 断点续传 /
 * 评分筛选 / 三层质量提升 / 双形态导出 / 检索 / 快捷键 / 主题……）。v9.1 出过一次事故——
 * 三个模块只有定义没有调用方，功能写了用户摸不到，README 却在宣传。
 * 那份教训催生了 test-wiring（模块有没有接线），这一份则是它的补集：
 * **对外的每一句承诺，都要能在源码里指到一行证据**。改坏了宣传也好、改漏了功能也好，一红就知道。
 *
 * 判定方法：静态读源码 + 正则指证。不是端到端测试（那需要真浏览器和真 Key），
 * 但足以拦住「承诺与实现脱节」这一类最大的失信风险。
 */

var fs = require('fs');
var path = require('path');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');
var README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
var META = SRC.slice(0, SRC.indexOf('==/UserScript==') + 20);

var pass = 0, fail = 0;
function claim(name, cond, detail) {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' —— ' + detail : '')); }
}
function has(re, src) { return new RegExp(re).test(src || SRC); }

// ===================== 一、三种字幕来源 =====================

claim('B 站：WBI 签名调用字幕接口', has("player/wbi/v2\\?' \\+ wbiQuery"));
claim('B 站：-403 风控自动刷新密钥重试一次', has("d\\.code === -403[\\s\\S]{0,120}getWbiKeys\\(true\\)"));
claim('B 站：人工字幕优先于 AI 字幕（打分函数剥 ai- 前缀）', has("langScore[\\s\\S]{0,400}replace\\(/\\^ai-/"));
claim('B 站：中文优先（语言顺序表以 zh 打头）', has("LANG_ORDER = \\['zh-CN'"));
claim('B 站：多 P 跟 P（从 URL 读分 P + 拉 pagelist）', has("player/pagelist\\?bvid=") && has('RouteIdentity\\.pageOf'));
claim('YouTube：解析字幕轨道并兼容 TTML 双形态', has('parseTtml') && has('adapters\\.youtube'));
claim('通用站：扫描 <video> 下的 track 并解析 VTT', has("querySelectorAll\\('track'\\)") && has('parseVtt'));
claim('字幕正文有缓存（切语言不重复下载）', has('cache\\[key\\]') && has('cache\\[key\\] = merged'));

// ===================== 二、无字幕时的四层防线 =====================

claim('① 分段解码：读 MP4 分片目录（sidx）逐片处理', has('parseSidx') && has('listBoxes'));
claim('② 整段直传：小文件原样送模型（体积阈值在）', has('RECORD_THRESHOLD_MB'));
claim('③ 解码切片：解码成 16kHz 后切片', has('DECODE_RATE') && /16000/.test(SRC));
claim('④ 静音播放录制兜底：存在且会兜底', has('recorderAsr') && has('播放录制'));
claim('前一路不通自动走下一路（分段失败回落整段/录制，不是一条路堵死）',
  has('分段解码不可用，回落到整段解码') && has('shouldUseRecord'));
claim('MIME 自愈：按文件头魔数纠正服务器标错的类型', has('probeMime') && has('ftyp'));
claim('转写全程静音（增益 0）', has('gain\\.value = 0'));
claim('选路前读真实时长与声道数（不拿体积猜码率）', has('probeMp4Channels') && has('estimateDecodedMB'));

// ===================== 三、进度与交互 =====================

claim('五阶段进度：download / probe / decode / transcribe / merge 全在',
  ["'download'", "'probe'", "'decode'", "'transcribe'", "'merge'"].every(function (s) { return SRC.indexOf(s) >= 0; }));
claim('实时字幕流（边转边显示）', has('bsrLive') && has('\\$\\(\'#bsrLive\'\\)'));
claim('预计剩余时间（按实测速度外推）', has('etaSec'));
claim('收起后的小胶囊', has('bsr-mini'));
claim('完成发系统通知', has('GM_notification'));
claim('可随时取消', has('asr\\.cancel') && has('#bsrCancel'));
claim('抓音用 AudioWorklet（页面卡顿不丢采样点）', has('AudioWorklet'));
claim('背压闸门（待转切片积压就暂停）', has('背压|backpressure|pause\\(\\)[\\s\\S]{0,80}积压'));

// ===================== 四、断点续传 =====================

claim('每批完成即落盘', has('SegResume\\.saveResume'));
claim('重转自动跳过已完成批次', has('SegResume\\.loadResume') && has('doneCount'));
claim('「↺ 重新开始」放弃断点', has('#bsrAsrRestart') && has('clearResume'));
claim('断点 24 小时有效', has('TTL_MS = 24 \\* 3600 \\* 1000'));
claim('失败批不计完成（下次重试）', has('saveResume\\(GM_setValue, Date\\.now\\(\\)[\\s\\S]{0,90}bi, segsAll\\)'));

// ===================== 五、搜索筛选 =====================

claim('B 站搜索免 Key（走 wbi 签名）', has('searchBilibili') && has('wbi'));
claim('YouTube 搜索用自备 Data API Key（不内置任何 Key）', has('bsr_yt_key') && !/AIza[0-9A-Za-z_-]{20,}/.test(SRC));
claim('逐条探测候选有无原生字幕', has('探测') && has('nativeSub|hasSub|subtitle'));
claim('结果用徽章标出有字幕 / 无字幕·需转写', has('bsr-sub yes') && has('无字幕·需转写'));
claim('排序有字幕优先、其次播放量', has('bn - an'));
claim('判字幕逐条请求有节流（降 412 概率）', has('randomDelayMs'));
claim('点卡片直接打开视频（不再二次点击看理由）', has('openCandidate'));

// ===================== 六、转写质量三层 =====================

claim('第 1 层：热词注入（词来自视频自己的标题/简介/标签）', has('hotwords') && has('buildHotwords|hotwordsFrom'));
claim('第 1 层：账号不支持时自动降级关开关', has('自动降级|不支持'));
claim('第 2 层：LLM 纠错，默认关（按调用计费）', has("llmCorrect: GM_getValue\\('bsr_llm_correct', false\\)"));
claim('第 2 层：响应硬校验（条目数/顺序一变整批拒绝）', has('条目数|顺序'));
claim('第 3 层：标点恢复 + 断句合并 + 相邻重复去重', has('polishOn') && has('TranscriptQuality'));

// ===================== 七、导出 =====================

claim('TXT 带 UTF-8 BOM（Windows 记事本不乱码）', has("'\\\\uFEFF' \\+"));
claim('SRT 带时间戳', has('bodyToSrt') && has('srtTime'));
claim('VTT 导出', has('SubExport\\.bodyToVtt'));
claim('一键复制（含 execCommand 兜底）', has('navigator\\.clipboard') && has('fallbackCopy'));
claim('AI 纯文本（剥时间戳）', has('bodyToAiText'));
claim('章节锚点稿（只标大锚点）', has('bodyToAnchoredText'));
claim('检索后导出只出命中行', has('activeBody'));
claim('可选翻译（目标语言 × 模型）', has('translateTo') && has('translateModel'));

// ===================== 八、v9.6–v9.10 新增承诺 =====================

claim('锚点/追踪参数不误伤（按视频身份比较）', has('RouteIdentity\\.isSameVideo'));
claim('换分 P 自动重新获取字幕', has('autoFetchOnPageSwitch'));
claim('进入视频自动获取字幕并复制（默认关，开启即自动取+复制）', has("bsr_auto_fetch', false") && has('scheduleAutoFetch'));
claim('导出默认只复制不落文件', has("exportMode: GM_getValue\\('bsr_export_mode', 'copy'\\)"));
claim('深色模式（跟随系统 + 手动切）', has('data-theme') && has('prefers-color-scheme: dark'));
claim('FAB 带可见文字', has('<span class="lb">字幕</span>'));
// 注意：模块是整段注入的，源码里出现的是正则字面量 player\.bilibili\.com（带反斜杠），
// 断言要匹配带转义的写法，否则假绿/假红都可能出现。
claim('页面形态认领表（含 iframe 嵌入播放器）',
  has('SiteMatch\\.detect') && has("form: 'embed'") && has('player\\\\.bilibili'));
claim('快捷键（输入框内不抢键）', has('hotkeysOn') && has("tagName === 'INPUT'"));
claim('点击字幕行跳到视频对应时间（同类脚本标配，默认开可关）', has('seekTo') && has('clickSeekOn'));
claim('字幕改可点击行列表（命中行高亮让跳转有意义）', has('bsr-line') && has('renderLines'));
claim('Markdown 导出', has('SubExport\\.bodyToMd') && has("\\.md'"));
claim('AI 总结提示词一键复制（提示词 + 稿子一起复制）', has('AI_PROMPTS') && has('buildPrompt'));
claim('时间轴偏移校正（转写时间轴对不上可整体挪，不产生负时间戳）', has('shiftBody') && has('shiftSec'));
claim('只导出当前播放位置之后', has('bodyFrom') && has('rangeFrom'));
claim('能写就能读回来：SRT / VTT 的导出器与解析器成对存在',
  has('function bodyToSrt') && has('function parseSrt') && has('bodyToVtt') && has('function parseVtt'));

// ===================== 九、安全与隐私承诺 =====================

claim('纯前端：没有向自有服务器上报（@connect 白名单内无作者域名）',
  !/@connect\s+(?!api\.bilibili|hdslb|aisubtitle|bilivideo|akamaized|api\.siliconflow|api\.openai|api\.deepseek|openrouter|www\.youtube|youtube\.com|video\.google|googlevideo|\*)\S+/i.test(META));
claim('密钥只存本地（走 GM 存储，不写死在源码里）',
  has("GM_setValue\\('bsr_ai_key'") && !/sk-[A-Za-z0-9]{20,}/.test(SRC));
claim('@grant 声明齐全（用啥声明啥，没有多余权限）',
  /@grant\s+GM_xmlhttpRequest/.test(META) && /@grant\s+GM_setValue/.test(META) && /@grant\s+GM_getValue/.test(META));
claim('远程文本写进 innerHTML 前统一转义', has('escHtml'));

// ===================== 九·五、AI 厂商通用化（v9.14.0） =====================

claim('AI 厂商可切换：内置多家预设（硅基流动 / OpenAI / DeepSeek / OpenRouter / 自定义）',
  has('AI_PROVIDERS = \\{') && has('siliconflow:') && has('openai:') && has('deepseek:') && has('openrouter:') && has('custom:'));
claim('转写 / 翻译调用的端点由通用解析得出（不再写死硅基流动域名）',
  has('aiBaseUrl') && has('aiEndpointPath') && has('aiAuthHeader') && !/url:\s*'https:\/\/api\.siliconflow\.cn/.test(SRC));
claim('旧写死函数已重构为通用函数（sfTranscribe→aiTranscribe，sfChat→aiChat）',
  has('aiTranscribe') && has('aiChat') && !has('function sfTranscribe') && !has('function sfChat'));
claim('每个厂商声明能力标记（是否支持语音转写 / 热词）',
  has('supportsAudio') && has('supportsHotwords'));
claim('DeepSeek 明确标记没有语音转写端点（避免点了转写却 404）',
  has("audio: null, chat: '/chat/completions'"));
claim('硅基流动预设端点正确（base + 音频/对话端点，拼接即真实可调用地址）',
  has("base: 'https://api.siliconflow.cn/v1'") && has("audio: '/audio/transcriptions'") && has("chat: '/chat/completions'"));
claim('OpenAI 预设端点正确（whisper 音频 + 对话，与官方一致）',
  has("base: 'https://api.openai.com/v1'") && has("audio: '/audio/transcriptions'") && has("chat: '/chat/completions'"));
claim('DeepSeek 端点正确（base + 仅对话，audio 为 null）',
  has("base: 'https://api.deepseek.com/v1'") && has("audio: null, chat: '/chat/completions'"));
// 反向断言：OpenRouter 官方有 /audio/transcriptions（multipart ≤25MB），
// 以前标成 audio:null + supportsAudio:false，等于把一条能用的路堵死还告诉用户「别点」。
claim('OpenRouter 端点正确（base + 对话 + 语音转写端点）',
  has("base: 'https://openrouter.ai/api/v1'") && has("audio: '/audio/transcriptions', chat: '/chat/completions'"));
claim('OpenRouter 标记为支持语音转写（supportsAudio 随端点一起置真）',
  has("audio: '/audio/transcriptions', chat: '/chat/completions',\\s+supportsAudio: true"));
claim('热词增强只在硅基流动启用，其它厂商不塞该参数（否则 4xx）',
  has('supportsHotwords') && has("\\(p\\.supportsHotwords\\) \\? currentHotwords\\(\\) : \\[\\]"));
claim('自定义厂商允许填自己的 API 根地址与音频端点',
  has("SETTINGS.aiBase") && has("SETTINGS.aiAudioEp") && has("bsrAiBase") && has("bsrAiAudioEp"));
claim('模型选择可手填任意 OpenAI 兼容模型名（datalist 既给预设也开放自由输入）',
  has('list="bsrAsrModelList"') && has('list="bsrTModelList"') && has('fillModelList'));
claim('换厂商时模型清单与 Key 提示同步刷新（refreshProviderUI 接线）',
  has('refreshProviderUI') && has("'#bsrAiProvider'") && has('currentProvider'));
claim('README 宣传了可切换 AI 厂商',
  /AI 厂商|厂商|OpenAI|DeepSeek|OpenRouter|自定义 OpenAI/.test(README));
claim('设置里提供「测试连接」按钮，切厂商后先验 Key 再烧额度',
  has("'#bsrAiTest'") && has("bsrAiTest") && has("'/models'"));
claim('测试连接对各厂商通用（走 /models 端点，非写死某家）',
  has("base \\+ '/models'") && has("'Authorization': 'Bearer ' \\+ key"));

// ===================== 十、文档与实现对齐 =====================

claim('README 与脚本版本号一致',
  (function () {
    var v = (SRC.match(/@version\s+(\S+)/) || [])[1];
    var b = (README.match(/badge\/version-([0-9][0-9.]*)-/) || [])[1];
    return !!v && v === b;
  })(), '版本号漂移');
claim('README 里宣传的快捷键，源码里三个键都在',
  /Alt\+S|Alt \+ S/.test(README) && has('e\\.altKey') && has("e\\.key === 'Escape'") && has("e\\.key === 'Enter'"));
claim('README 里宣传的「3 小时长音频」，源码里有对应的长音频硬化',
  /3 小时/.test(README) && has('RECORD_THRESHOLD_MB') && has('estimateDecodedMB'));
claim('README 里宣传的「零后端」，源码确实没有 fetch 到外部自有服务',
  /纯前端/.test(README) && !/fetch\('https?:\/\/(?!api\.bilibili|[\w.]*youtube|[\w.]*googlevideo|api\.siliconflow)/.test(SRC));

console.log('----------------------------------------');
console.log(fail === 0 ? 'PASS ' + pass + '/' + (pass + fail) : 'FAIL ' + fail + ' 项（共 ' + (pass + fail) + '）');
process.exit(fail === 0 ? 0 : 1);
