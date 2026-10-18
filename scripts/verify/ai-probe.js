// 定向复刻 bili-subtitle.user.js 里「构造 AI 请求」的几段逻辑（v9.16.1 L2499-2511 / L2531-2543 / L3383-3390 / L4341-4365），
// 把 base 指向本地 mock server，抓取脚本真实会发出的 request line / headers / multipart body。
// 只做取证，不修改仓库源码。
'use strict';

// ---------- 以下为源码原样复制（AI_PROVIDERS 预设） ----------
var AI_PROVIDERS = {
  siliconflow: {
    label: '硅基流动 SiliconFlow',
    base: 'https://api.siliconflow.cn/v1',
    audio: '/audio/transcriptions', chat: '/chat/completions',
    supportsAudio: true, supportsHotwords: true,
    keyPlaceholder: 'sk-...',
    asrModels: ['FunAudioLLM/SenseVoiceSmall', 'FunAudioLLM/SenseVoiceLarge'],
    chatModels: ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'moonshotai/Kimi-K2-Instruct']
  },
  openai: {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    audio: '/audio/transcriptions', chat: '/chat/completions',
    supportsAudio: true, supportsHotwords: false,
    keyPlaceholder: 'sk-...',
    asrModels: ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'],
    chatModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    audio: null, chat: '/chat/completions',
    supportsAudio: false, supportsHotwords: false,
    keyPlaceholder: 'sk-...',
    chatModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  openrouter: {
    label: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    audio: null, chat: '/chat/completions',
    supportsAudio: false, supportsHotwords: false,
    keyPlaceholder: 'sk-or-...',
    chatModels: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-8b-instruct']
  },
  custom: {
    label: '自定义 OpenAI 兼容',
    base: '', audio: '/audio/transcriptions', chat: '/chat/completions',
    supportsAudio: true, supportsHotwords: false,
    keyPlaceholder: '你的 Key',
    asrModels: [], chatModels: []
  }
};

// 把预设 base 换成本地 mock，让请求真的能发出去
var MOCK = 'http://127.0.0.1:' + (process.env.PORT || 8787);
Object.keys(AI_PROVIDERS).forEach(function (k) {
  if (AI_PROVIDERS[k].base) AI_PROVIDERS[k].base = MOCK + '/v1';
});

var SETTINGS = {
  aiProvider: 'siliconflow',
  aiKey: 'sk-TEST-KEY',
  aiBase: '',
  aiAudioEp: '',
  asrLang: 'zh',
  asrModel: 'FunAudioLLM/SenseVoiceSmall',
  translateModel: 'Qwen/Qwen2.5-72B-Instruct',
  hotwordsOn: true
};

function currentProvider() { return AI_PROVIDERS[SETTINGS.aiProvider] || AI_PROVIDERS.siliconflow; }
function aiBaseUrl() {
  var b = (SETTINGS.aiProvider === 'custom') ? (SETTINGS.aiBase || '') : currentProvider().base;
  return (b || '').replace(/\/+$/, '');
}
function aiEndpointPath(kind) {
  var p = currentProvider();
  var ep = (SETTINGS.aiProvider === 'custom')
    ? (kind === 'audio' ? (SETTINGS.aiAudioEp || p.audio) : p.chat)
    : (kind === 'audio' ? p.audio : p.chat);
  return (ep || '').replace(/^\/+/, '');
}
function aiAuthHeader() { return { 'Authorization': 'Bearer ' + (SETTINGS.aiKey || '') }; }
// ---------- 复制结束 ----------

function buildAudioUrl() { return aiBaseUrl() + '/' + aiEndpointPath('audio'); }
function buildChatUrl() { return aiBaseUrl() + '/' + aiEndpointPath('chat'); }

function buildFormData(hotwords) {
  var fd = new FormData();
  fd.append('model', SETTINGS.asrModel);
  fd.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }), 'chunk.wav');
  if (SETTINGS.asrLang && SETTINGS.asrLang !== 'auto') fd.append('language', SETTINGS.asrLang);
  if (hotwords && hotwords.length) fd.append('hotwords', JSON.stringify(hotwords));
  fd.append('response_format', 'srt');
  return fd;
}

async function send(url, init) {
  try {
    var r = await fetch(url, init);
    var t = await r.text();
    return 'HTTP ' + r.status + ' / body=' + t.slice(0, 120);
  } catch (e) {
    return 'FETCH FAILED: ' + e.message;
  }
}

(async function main() {
  var out = [];
  function line(s) { out.push(s); process.stdout.write(s + '\n'); }

  // ① 硅基流动：带热词 + 语言 + response_format=srt
  line('\n### 用例1 siliconflow · 音频转写（热词开 + 语言 zh）');
  SETTINGS.aiProvider = 'siliconflow';
  SETTINGS.asrModel = 'FunAudioLLM/SenseVoiceSmall';
  line('URL = ' + buildAudioUrl());
  line('结果 = ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData(['蓝桥杯', 'STM32']) }));

  // ② 硅基流动：下拉里的第二个预设模型 SenseVoiceLarge
  line('\n### 用例2 siliconflow · 下拉预设第二项 FunAudioLLM/SenseVoiceLarge');
  SETTINGS.asrModel = 'FunAudioLLM/SenseVoiceLarge';
  line('URL = ' + buildAudioUrl());
  line('结果 = ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData([]) }));
  SETTINGS.asrModel = 'FunAudioLLM/SenseVoiceSmall';

  // ③ OpenAI：gpt-4o-mini-transcribe（官方文档：只支持 response_format=json）
  line('\n### 用例3 openai · gpt-4o-mini-transcribe（仍带 response_format=srt）');
  SETTINGS.aiProvider = 'openai';
  SETTINGS.asrModel = 'gpt-4o-mini-transcribe';
  line('URL = ' + buildAudioUrl());
  line('结果 = ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData([]) }));

  // ④ OpenAI：切厂商后模型名是否跟着变？（脚本不会重置）
  line('\n### 用例4 openai · 从硅基流动切过来，asrModel 仍是上一个厂商的模型名');
  SETTINGS.asrModel = 'FunAudioLLM/SenseVoiceSmall';
  line('URL = ' + buildAudioUrl());
  line('结果 = ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData([]) }));

  // ⑤ DeepSeek / OpenRouter：supportsAudio=false，应在发请求前就被拒
  line('\n### 用例5 deepseek · 点转写');
  SETTINGS.aiProvider = 'deepseek';
  line('是否发请求：' + (currentProvider().supportsAudio ? '会（缺陷）' : '不会，直接 reject'));
  line('构造出的 URL（若强行发）= ' + buildAudioUrl());
  line('\n### 用例6 openrouter · 点转写');
  SETTINGS.aiProvider = 'openrouter';
  line('是否发请求：' + (currentProvider().supportsAudio ? '会（缺陷）' : '不会，直接 reject（但 OpenRouter 实际有 /audio/transcriptions）'));
  line('构造出的 URL（若强行发）= ' + buildAudioUrl());

  // ⑥ 自定义：base 留空
  line('\n### 用例7 custom · API 根地址留空');
  SETTINGS.aiProvider = 'custom';
  SETTINGS.aiBase = '';
  SETTINGS.aiAudioEp = '';
  line('URL = "' + buildAudioUrl() + '"  → ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData([]) }));

  // ⑦ 自定义：base 正常
  line('\n### 用例8 custom · base=http://127.0.0.1:PORT/v1，音频端点留空');
  SETTINGS.aiBase = MOCK + '/v1';
  line('URL = ' + buildAudioUrl());
  line('结果 = ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData([]) }));

  // ⑧ 自定义：base 末尾带斜杠
  line('\n### 用例9 custom · base 末尾带 /// ');
  SETTINGS.aiBase = MOCK + '/v1///';
  line('URL = ' + buildAudioUrl());
  SETTINGS.aiBase = MOCK + '/v1';

  // ⑨ 自定义：音频端点填了完整 URL
  line('\n### 用例10 custom · 音频端点填了完整 URL');
  SETTINGS.aiAudioEp = 'https://other.host/v1/audio/transcriptions';
  line('URL = ' + buildAudioUrl());
  line('结果 = ' + await send(buildAudioUrl(), { method: 'POST', headers: aiAuthHeader(), body: buildFormData([]) }));
  SETTINGS.aiAudioEp = '';

  // ⑩ 对话/翻译：payload 字段
  line('\n### 用例11 openai · 对话端点 payload');
  SETTINGS.aiProvider = 'openai';
  var chatBody = JSON.stringify({ model: SETTINGS.translateModel, messages: [{ role: 'user', content: 'PROMPT' }], temperature: 0.2 });
  line('URL = ' + buildChatUrl());
  line('BODY = ' + chatBody);
  line('结果 = ' + await send(buildChatUrl(), { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, aiAuthHeader()), body: chatBody }));

  // ⑪ 测试连接：GET {base}/models
  line('\n### 用例12 测试连接 GET {base}/models');
  ['siliconflow', 'openai', 'deepseek', 'openrouter'].forEach(function (p) {
    SETTINGS.aiProvider = p;
    line('  ' + p + ' → GET ' + aiBaseUrl() + '/models  （真实域名下为 ' +
      (p === 'deepseek' ? 'https://api.deepseek.com/v1/models' : '预设 base + /models') + '）');
  });

  require('fs').writeFileSync(__dirname + '/shots/probe-report.txt', out.join('\n'));
})();
