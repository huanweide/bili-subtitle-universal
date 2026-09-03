// ==UserScript==
// @name         全网视频字幕提取 · AI 转写版
// @namespace    https://github.com/huanweide/bili-subtitle
// @version      8.1.2
// @description  在任意网页视频上悬浮按钮，一键提取字幕：B站官方字幕（WBI 签名）、YouTube 字幕、任意站点的 WebVTT 字幕；无字幕时自动用「硅基流动」SenseVoice AI 语音转写（MIME 自愈 + 内存预检，3 小时长音频自动「播放录制」兜底，稳得离谱）；可选高质量翻译。
// @author       阿梓 (AI 增强版)
// @icon         https://www.bilibili.com/favicon.ico
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.bilibili.com
// @connect      hdslb.com
// @connect      aisubtitle.hdslb.com
// @connect      bilivideo.com
// @connect      bilivideo.cn
// @connect      akamaized.net
// @connect      api.siliconflow.cn
// @connect      www.youtube.com
// @connect      youtube.com
// @connect      video.google.com
// @connect      googlevideo.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 状态 =====================
  var state = {
    adapter: null,     // 当前站点适配器
    site: '',          // 'bilibili' | 'youtube' | 'html5' | ''
    bvid: '', aid: '', cid: null,
    videoId: '',       // YouTube videoId
    title: '', up: '', desc: '', duration: 0,
    page: 1, pageTitle: '', totalPages: 1,
    subs: [],          // [{lan, lan_doc, urls:[], ai, kind}]
    body: null,        // 当前字幕 body 数组 [{from,to,content}]
    lan: '',
    loading: false, err: '', noSub: false,
    asr: null,         // {phase, done, total, cancel, progress, chunks, eta, t0}
    asrRan: false,
    audioBlob: null,   // 已下载的音频 blob（复用）
    audioBuf: null     // 已解码的 AudioBuffer（复用）
  };
  var cache = {};      // key -> body 数组

  // ===================== 设置（持久化） =====================
  var SETTINGS = {
    sfKey: GM_getValue('bsr_sf_key', ''),
    asrEnable: GM_getValue('bsr_asr_enable', true),
    asrFallback: GM_getValue('bsr_asr_fallback', true),
    asrForce: GM_getValue('bsr_asr_force', false),
    asrLang: GM_getValue('bsr_asr_lang', 'auto'),
    asrChunkMin: GM_getValue('bsr_asr_chunk', 20),
    asrModel: GM_getValue('bsr_asr_model', 'FunAudioLLM/SenseVoiceSmall'),
    translateTo: GM_getValue('bsr_translate_to', 'none'),
    translateModel: GM_getValue('bsr_translate_model', 'Qwen/Qwen2.5-72B-Instruct')
  };
  function saveSettings() {
    try {
      GM_setValue('bsr_sf_key', SETTINGS.sfKey);
      GM_setValue('bsr_asr_enable', SETTINGS.asrEnable);
      GM_setValue('bsr_asr_fallback', SETTINGS.asrFallback);
      GM_setValue('bsr_asr_force', SETTINGS.asrForce);
      GM_setValue('bsr_asr_lang', SETTINGS.asrLang);
      GM_setValue('bsr_asr_chunk', SETTINGS.asrChunkMin);
      GM_setValue('bsr_asr_model', SETTINGS.asrModel);
      GM_setValue('bsr_asr_longmode', SETTINGS.asrLongMode);
      GM_setValue('bsr_asr_playrate', SETTINGS.asrPlayRate);
      GM_setValue('bsr_translate_to', SETTINGS.translateTo);
      GM_setValue('bsr_translate_model', SETTINGS.translateModel);
    } catch (e) { log('设置保存失败', e); }
  }

  var LANG_NAMES = { zh: '中文', en: '英文', ja: '日文', ko: '韩文', yue: '粤语', fr: '法文', de: '德文', es: '西班牙文', pt: '葡萄牙文', ru: '俄文', ar: '阿拉伯文' };

  // ===================== 工具 =====================
  function log() { console.log.apply(console, ['%c[全网字幕]', 'color:#FB7299;font-weight:bold'].concat([].slice.call(arguments))); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function decodeEntities(s) {
    var ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }

  // 语言排序：人工字幕 > AI 字幕；中文优先，其次英文/日文/韩文...
  var LANG_ORDER = ['zh-CN', 'zh', 'zh-Hans', 'zh-Hant', 'yue', 'en', 'ja', 'ko', 'es', 'pt', 'ar', 'th', 'vi', 'fr', 'de', 'ru', 'it', 'id', 'ms', 'hi'];
  function langScore(sub) {
    var base = (sub.lan || '').replace(/^ai-/, '').replace(/^asr-/i, '');
    var idx = LANG_ORDER.indexOf(base);
    if (idx < 0) idx = 50;
    return (sub.ai ? 1000 : 0) + idx;
  }
  function pickLanguage(subs) {
    if (!subs.length) return '';
    var best = subs[0];
    for (var i = 1; i < subs.length; i++) if (langScore(subs[i]) < langScore(best)) best = subs[i];
    return best.lan;
  }
  function sameLang(lan, target) {
    var a = (lan || '').replace(/^ai-/, '').replace(/^asr-/i, '').toLowerCase();
    var b = (target || '').toLowerCase();
    if (!a || !b) return false;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  function srtTime(t) {
    var s = Math.floor(t);
    var ms = Math.round((t - s) * 1000);
    if (ms === 1000) { s += 1; ms = 0; }
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(sec, 2) + ',' + p(ms, 3);
  }
  function bodyToTxt(body) { return body.map(function (x) { return x.content; }).join('\n'); }
  function bodyToSrt(body) {
    var out = [];
    for (var i = 0; i < body.length; i++) {
      var x = body[i];
      out.push(String(i + 1));
      out.push(srtTime(x.from) + ' --> ' + srtTime(x.to));
      out.push(x.content);
      out.push('');
    }
    return out.join('\n') + '\n';
  }
  function safeName(s) { return (s || 'video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }

  // 合并多个字幕片段：展开 -> 按 from 排序 -> 去重
  function mergeBodies(parts) {
    var all = [];
    parts.forEach(function (b) { if (b && b.body && b.body.length) all = all.concat(b.body); });
    all.sort(function (a, b) { return (a.from || 0) - (b.from || 0); });
    var seen = {}, out = [];
    all.forEach(function (x) {
      var k = (x.from || 0) + '|' + (x.content || '');
      if (!seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  }
  function checkIntegrity(body, duration) {
    if (!body || !body.length || !duration) return false;
    if (duration > 40 * 60) return false;
    var lastTo = body[body.length - 1].to || 0;
    return lastTo < duration * 0.6;
  }
  function getVideoInfoText() {
    var lines = ['【标题】' + (state.totalPages > 1 ? 'P' + state.page + ' ' + (state.pageTitle || '') + ' · ' : '') + (state.title || '未知')];
    if (state.up) lines.push('【UP主】' + state.up);
    if (state.desc) lines.push('【简介】' + state.desc);
    return lines.join('\n');
  }

  // ===================== 网络（GM_xmlhttpRequest 包 Promise，带重试） =====================
  function gx(url, opts) {
    opts = opts || {};
    var retries = opts.retries || 0;
    var timeout = opts.timeout || 10000;
    var referer = opts.referer || location.origin || 'https://www.bilibili.com/';
    return new Promise(function (resolve, reject) {
      function attempt(n) {
        GM_xmlhttpRequest({
          method: opts.method || 'GET',
          url: url,
          headers: Object.assign({ 'Referer': referer, 'User-Agent': navigator.userAgent }, opts.headers || {}),
          timeout: timeout,
          responseType: opts.responseType || 'text',
          data: opts.data,
          onload: function (r) {
            if (r.status >= 200 && r.status < 300) resolve(r.response);
            else if (n < retries) { setTimeout(function () { attempt(n + 1); }, 500 * (n + 1)); }
            else reject(new Error('HTTP ' + r.status));
          },
          onerror: function () {
            if (n < retries) setTimeout(function () { attempt(n + 1); }, 500 * (n + 1));
            else reject(new Error('network error'));
          },
          ontimeout: function () {
            if (n < retries) attempt(n + 1);
            else reject(new Error('请求超时'));
          },
          onprogress: opts.onprogress
        });
      }
      attempt(0);
    });
  }

  // ===================== WBI 签名（B站字幕/播放接口强制要求） =====================
  var MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
  var hexChr = '0123456789abcdef'.split('');
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function md5blk(s) {
    var md5blks = [], i;
    for (i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    return md5blks;
  }
  function md51(s) {
    var n = s.length, st = [1732584193, -271733879, -1732584194, 271733878], i;
    for (i = 64; i <= s.length; i += 64) md5cycle(st, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { md5cycle(st, tail); tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
    tail[14] = n * 8;
    md5cycle(st, tail);
    return st;
  }
  function rhex(n) { var s = '', j; for (j = 0; j < 4; j++) s += hexChr[(n >> (j * 8 + 4)) & 0x0F] + hexChr[(n >> (j * 8)) & 0x0F]; return s; }
  function hex(x) { return x.map(rhex).join(''); }
  function md5(s) { return hex(md51(s)); }
  function getMixinKey(orig) {
    var s = '';
    for (var i = 0; i < MIXIN_TAB.length; i++) s += orig[MIXIN_TAB[i]];
    return s.slice(0, 32);
  }
  function buildQs(obj) {
    return Object.keys(obj).sort().map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]); }).join('&');
  }
  var wbiCache = { img: '', sub: '', t: 0 };
  function wbiSign(params) {
    var mixin = getMixinKey(wbiCache.img + wbiCache.sub);
    params = Object.assign({}, params);
    params.wts = Math.round(Date.now() / 1000);
    var q = Object.keys(params)
      .filter(function (k) { return params[k] !== undefined && params[k] !== ''; })
      .sort()
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    params.w_rid = md5(q + mixin);
    return params;
  }
  function wbiQuery(params) { return buildQs(wbiSign(params)); }

  var wbiLoading = null;
  function getWbiKeys(force) {
    var now = Date.now();
    if (!force && wbiCache.img && now - wbiCache.t < 12 * 3600 * 1000) return Promise.resolve(wbiCache);
    if (wbiLoading) return wbiLoading;
    wbiLoading = gx('https://api.bilibili.com/x/web-interface/nav', { timeout: 8000, retries: 2, referer: 'https://www.bilibili.com/' })
      .then(JSON.parse)
      .then(function (d) {
        if (d.code !== 0 || !d.data || !d.data.wbi_img || !d.data.wbi_img.img_url) throw new Error('获取 wbi key 失败 code=' + d.code);
        wbiCache.img = d.data.wbi_img.img_url.split('/').pop().split('.')[0];
        wbiCache.sub = d.data.wbi_img.sub_url.split('/').pop().split('.')[0];
        wbiCache.t = Date.now();
        return wbiCache;
      })
      .finally(function () { wbiLoading = null; });
    return wbiLoading;
  }

  // ===================== 字幕解析器（通用） =====================
  function parseSrt(text) {
    var out = [];
    var blocks = String(text).split(/\r?\n\r?\n/);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i].trim();
      if (!b) continue;
      var lines = b.split(/\r?\n/);
      var m = null, j;
      for (j = 0; j < lines.length; j++) {
        m = lines[j].match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);
        if (m) break;
      }
      if (!m) continue;
      var from = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
      var to = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
      var content = lines.slice(j + 1).filter(function (l) { return l && !/^\d+$/.test(l.trim()); }).join('\n').trim();
      if (content) out.push({ from: from, to: to, content: content });
    }
    return out;
  }
  function vttTime(s) {
    s = (s || '').trim();
    var parts = s.split(':');
    var h = 0, m = 0, sec = 0;
    if (parts.length === 3) { h = +parts[0]; m = +parts[1]; sec = parseFloat(parts[2]); }
    else if (parts.length === 2) { m = +parts[0]; sec = parseFloat(parts[1]); }
    else sec = parseFloat(parts[0]) || 0;
    return h * 3600 + m * 60 + sec;
  }
  function parseVtt(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var arrow = line.indexOf('-->');
      if (arrow < 0) continue;
      var from = vttTime(line.slice(0, arrow));
      var to = vttTime(line.slice(arrow + 3).split(/\s/)[0]);
      var content = [];
      var j = i + 1;
      while (j < lines.length && lines[j].trim() !== '') {
        content.push(lines[j].trim().replace(/<[^>]+>/g, ''));
        j++;
      }
      i = j;
      var txt = content.join('\n').trim();
      if (txt) out.push({ from: from, to: to, content: txt });
    }
    return out;
  }
  function parseTtml(xmlText) {
    var out = [];
    try {
      var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      var texts = doc.getElementsByTagName('text');
      for (var i = 0; i < texts.length; i++) {
        var t = texts[i];
        var start = parseFloat(t.getAttribute('start') || '0');
        var dur = parseFloat(t.getAttribute('dur') || '0');
        var content = (t.textContent || '').trim();
        if (content) out.push({ from: start, to: start + (dur || 1), content: content });
      }
    } catch (e) { log('TTML 解析失败', e); }
    return out;
  }

  // ===================== 站点适配器 =====================
  // 每个适配器: { id, match(), resolve(), fetchSubs(), getAudio() }
  var adapters = {};

  // ---------- B站 ----------
  adapters.bilibili = {
    id: 'bilibili',
    match: function () { return /^https?:\/\/(www\.)?bilibili\.com\/(video\/BV|bangumi\/play\/)/i.test(location.href); },
    resolve: async function () {
      var st = window.__INITIAL_STATE__ || {};
      try {
        if (st.videoData) {
          state.bvid = st.videoData.bvid || '';
          state.aid = st.videoData.aid || '';
          state.cid = st.videoData.cid || null;
          state.up = (st.videoData.owner && st.videoData.owner.name) || '';
          state.desc = st.videoData.desc || '';
          state.duration = Number(st.videoData.duration) || 0;
          state.title = st.videoData.title || '';
        }
        if (st.epInfo && st.epInfo.title) state.title = state.title || st.epInfo.title;
        if (st.epInfo && st.epInfo.duration && !state.duration) state.duration = Number(st.epInfo.duration) || 0;
      } catch (e) {}
      if (!state.title) { try { state.title = document.title.replace(/_哔哩哔哩.*/, '').trim(); } catch (e) {} }
      if (!state.bvid) { var m = location.pathname.match(/BV\w+/); if (m) state.bvid = m[0]; }
      var pm = location.search.match(/[?&]p=(\d+)/);
      state.page = pm ? (parseInt(pm[1], 10) || 1) : 1;
      if (state.bvid) {
        try {
          var pl = JSON.parse(await gx('https://api.bilibili.com/x/player/pagelist?bvid=' + state.bvid, { timeout: 8000, retries: 1, referer: 'https://www.bilibili.com/' }));
          if (pl.code === 0 && pl.data && pl.data.length) {
            state.totalPages = pl.data.length;
            var idx = Math.min(Math.max(state.page - 1, 0), pl.data.length - 1);
            var pg = pl.data[idx];
            if (pg) {
              if (pg.cid) state.cid = pg.cid;
              if (!state.aid) state.aid = pg.aid || (pl.data[0] && pl.data[0].aid) || state.aid;
              state.pageTitle = pg.part || '';
              if (pg.duration) state.duration = Number(pg.duration) || state.duration;
            }
          }
        } catch (e) { log('pagelist 失败', e); }
        try {
          var vd = JSON.parse(await gx('https://api.bilibili.com/x/web-interface/view?bvid=' + state.bvid, { timeout: 8000, retries: 1, referer: 'https://www.bilibili.com/' }));
          if (vd.code === 0 && vd.data) {
            var d = vd.data;
            if (!state.aid && d.aid) state.aid = d.aid;
            if (!state.title) state.title = d.title || '';
            if (!state.up && d.owner && d.owner.name) state.up = d.owner.name;
            if (!state.desc && d.desc) state.desc = d.desc;
            if (!state.duration && d.duration) state.duration = Number(d.duration) || 0;
          }
        } catch (e) { log('view API 失败', e); }
      } else if (!state.cid && st.epInfo && st.epInfo.cid) {
        state.cid = st.epInfo.cid;
        if (!state.aid && st.epInfo.aid) state.aid = st.epInfo.aid;
      }
      return !!state.cid;
    },
    fetchSubs: async function () {
      var params = { cid: state.cid, isGaiaAvoided: true };
      if (state.bvid) params.bvid = state.bvid; else params.aid = state.aid;
      var d = null, lastErr = null;
      try {
        await getWbiKeys();
        d = JSON.parse(await gx('https://api.bilibili.com/x/player/wbi/v2?' + wbiQuery(params), { timeout: 10000, retries: 1, referer: 'https://www.bilibili.com/' }));
        if (d.code === -403) {
          await getWbiKeys(true);
          d = JSON.parse(await gx('https://api.bilibili.com/x/player/wbi/v2?' + wbiQuery(params), { timeout: 10000, retries: 1, referer: 'https://www.bilibili.com/' }));
        }
      } catch (e) { lastErr = e; log('wbi/v2 失败，回退 v2', e); }
      if (!d || d.code !== 0) {
        try {
          d = JSON.parse(await gx('https://api.bilibili.com/x/player/v2?' + buildQs(params), { timeout: 10000, retries: 1, referer: 'https://www.bilibili.com/' }));
        } catch (e) { lastErr = e; }
      }
      if (!d) throw lastErr || new Error('字幕接口无响应');
      if (d.code !== 0) {
        var msg = '字幕接口返回 code=' + d.code;
        if (d.code === -101) msg += '（AI 字幕通常需登录 B 站账号）';
        else if (d.code === -403) msg += '（接口风控，稍后重试或启用 AI 转写）';
        throw new Error(msg);
      }
      var list = (d.data && d.data.subtitle && d.data.subtitle.subtitles) || [];
      var byLan = {};
      list.forEach(function (s) {
        var url = s.subtitle_url;
        if (!url) return;
        if (url.indexOf('http') !== 0) url = 'https:' + url;
        var lan = s.lan || 'unknown';
        if (!byLan[lan]) byLan[lan] = { lan: lan, lan_doc: s.lan_doc || lan, urls: [], ai: lan.indexOf('ai-') === 0 };
        byLan[lan].urls.push(url);
      });
      return Object.keys(byLan).map(function (k) { return byLan[k]; }).sort(function (a, b) { return langScore(a) - langScore(b); });
    },
    getAudio: async function () {
      var params = { cid: state.cid, fnval: 16, fnver: 0, fourk: 1 };
      if (state.bvid) params.bvid = state.bvid; else params.aid = state.aid;
      var d = await getWbiKeys().then(function () {
        return gx('https://api.bilibili.com/x/player/wbi/playurl?' + wbiQuery(params), { timeout: 15000, retries: 2, referer: 'https://www.bilibili.com/' }).then(JSON.parse);
      });
      if (d.code === -403) {
        d = await getWbiKeys(true).then(function () {
          return gx('https://api.bilibili.com/x/player/wbi/playurl?' + wbiQuery(params), { timeout: 15000, retries: 2, referer: 'https://www.bilibili.com/' }).then(JSON.parse);
        });
      }
      if (d.code !== 0) throw new Error('获取播放地址失败 code=' + d.code);
      var audio = null;
      if (d.data && d.data.dash && d.data.dash.audio && d.data.dash.audio.length) {
        audio = d.data.dash.audio.slice().sort(function (a, b) { return (a.bandwidth || 0) - (b.bandwidth || 0); })[0];
      } else if (d.data && d.data.durl && d.data.durl.length) {
        audio = { baseUrl: d.data.durl[0].url };
      }
      if (!audio || !audio.baseUrl) throw new Error('未找到音频流');
      return audio.baseUrl.replace(/^http:/, 'https:');
    }
  };

  // ---------- YouTube ----------
  adapters.youtube = {
    id: 'youtube',
    match: function () { return /(^|\.)youtube\.com$|youtu\.be/i.test(location.hostname); },
    resolve: async function () {
      var yt = window.ytInitialPlayerResponse || window.ytInitialData || {};
      var vd = yt.videoDetails || {};
      if (vd.videoId) state.videoId = vd.videoId;
      if (vd.title) state.title = vd.title;
      if (vd.author) state.up = vd.author;
      if (vd.lengthSeconds) state.duration = Number(vd.lengthSeconds) || 0;
      if (!state.title) { try { state.title = document.title.replace(/\s*-\s*YouTube$/, '').trim(); } catch (e) {} }
      var cap = yt.captions && yt.captions.playerCaptionsTracklistRenderer;
      var tracks = (cap && cap.captionTracks) || [];
      var byLan = {};
      tracks.forEach(function (t) {
        var lan = t.languageCode || 'unknown';
        var url = t.baseUrl || '';
        if (!url) return;
        var isAuto = (t.kind === 'asr' || (t.name && /auto|自动/i.test(t.name.simpleText || '')));
        var name = (t.name && t.name.simpleText) || lan;
        if (!byLan[lan]) byLan[lan] = { lan: lan, lan_doc: name, urls: [], ai: isAuto };
        byLan[lan].urls.push(url);
      });
      state.subs = Object.keys(byLan).map(function (k) { return byLan[k]; }).sort(function (a, b) { return langScore(a) - langScore(b); });
      return !!state.videoId;
    },
    fetchSubs: async function () {
      // resolve 里已填充 state.subs，这里只回传
      return state.subs;
    },
    getSubBody: async function (lan) {
      var sub = null;
      for (var i = 0; i < state.subs.length; i++) if (state.subs[i].lan === lan) sub = state.subs[i];
      if (!sub) throw new Error('未找到该语言字幕');
      var parts = await Promise.all(sub.urls.map(function (u) {
        var full = u.indexOf('http') === 0 ? u : 'https://www.youtube.com' + u;
        return gx(full + (full.indexOf('?') >= 0 ? '&' : '?') + 'fmt=ttml', { timeout: 30000, retries: 1, referer: 'https://www.youtube.com/' });
      }));
      var merged = mergeBodies(parts.map(function (p) { return { body: parseTtml(p) }; }));
      if (!merged.length) throw new Error('字幕内容为空');
      return merged;
    },
    getAudio: async function () { return null; } // YouTube 音频需解流媒体签名，暂不支持
  };

  // ---------- 通用 HTML5 ----------
  adapters.html5 = {
    id: 'html5',
    match: function () { return !!document.querySelector('video'); },
    resolve: async function () {
      var v = document.querySelector('video');
      if (!v) return false;
      state.html5Video = v;
      state.title = document.title || '视频';
      if (v.duration && isFinite(v.duration)) state.duration = v.duration;
      // 收集 <track> 字幕
      var tracks = v.querySelectorAll('track');
      var byLan = {};
      tracks.forEach(function (t) {
        var src = t.getAttribute('src');
        if (!src) return;
        try { src = new URL(src, location.href).href; } catch (e) { return; }
        var lang = t.getAttribute('srclang') || t.getAttribute('lang') || 'unknown';
        var label = t.getAttribute('label') || lang;
        var kind = (t.getAttribute('kind') || '').toLowerCase();
        if (kind && kind !== 'subtitles' && kind !== 'captions') return;
        if (!byLan[lang]) byLan[lang] = { lan: lang, lan_doc: label, urls: [], ai: false };
        byLan[lang].urls.push(src);
      });
      state.subs = Object.keys(byLan).map(function (k) { return byLan[k]; }).sort(function (a, b) { return langScore(a) - langScore(b); });
      return true;
    },
    fetchSubs: async function () { return state.subs; },
    getSubBody: async function (lan) {
      var sub = null;
      for (var i = 0; i < state.subs.length; i++) if (state.subs[i].lan === lan) sub = state.subs[i];
      if (!sub) throw new Error('未找到该语言字幕');
      var parts = await Promise.all(sub.urls.map(function (u) {
        return gx(u, { timeout: 30000, retries: 1, referer: location.href });
      }));
      var merged = mergeBodies(parts.map(function (p) { return { body: parseVtt(p) }; }));
      if (!merged.length) throw new Error('字幕内容为空');
      return merged;
    },
    getAudio: async function () {
      var v = state.html5Video || document.querySelector('video');
      if (!v) return null;
      var src = v.currentSrc || v.src || '';
      if (!src || /^blob:/i.test(src)) return null; // blob 流（MSE）无法直接下载
      try { return new URL(src, location.href).href; } catch (e) { return null; }
    }
  };

  function detectAdapter() {
    var order = ['bilibili', 'youtube', 'html5'];
    for (var i = 0; i < order.length; i++) {
      var a = adapters[order[i]];
      if (a.match()) return a;
    }
    return null;
  }

  // ===================== 音频解码 / 重采样 / 切片（核心，修复跨上下文 bug） =====================
  // 关键修复：彻底废弃「MediaElementSource + 实时 AudioContext 跨接 OfflineAudioContext」的错误路线，
  // 改为「decodeAudioData 整体解码 -> OfflineAudioContext 按片重采样」的同上下文正确路线。

  function downloadAudio(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET', url: url, responseType: 'blob',
        headers: { 'Referer': location.origin || 'https://www.bilibili.com/', 'User-Agent': navigator.userAgent },
        timeout: 600000,
        onload: function (r) {
          if ((r.status >= 200 && r.status < 300) && r.response) resolve(r.response);
          else if (r.status === 206 && r.response) resolve(r.response);
          else reject(new Error('音频下载失败 HTTP ' + r.status));
        },
        onerror: function () { reject(new Error('音频下载网络错误')); },
        ontimeout: function () { reject(new Error('音频下载超时')); },
        onprogress: function (p) {
          if (state.asr && p && p.lengthComputable) { state.asr.progress = Math.round(p.loaded / p.total * 100); render(); }
        }
      });
    });
  }

  // blob 魔数 -> 真实 MIME（decode 失败常见根因：容器类型被误标）
  function probeMime(buf) {
    try {
      var u8 = new Uint8Array(buf, 0, 16);
      function asc(o, n) { var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(u8[o + i] || 0); return s; }
      var b0 = u8[0], b1 = u8[1], b2 = u8[2], b3 = u8[3];
      if (b0 === 0x1A && b1 === 0x45 && b2 === 0xDF && b3 === 0xA3) return 'audio/webm';   // EBML (webm)
      if (asc(0, 4) === 'OggS') return 'audio/ogg';
      if (asc(0, 4) === 'RIFF' && asc(8, 4) === 'WAVE') return 'audio/wav';
      if (asc(0, 4) === 'fLaC') return 'audio/flac';
      if (asc(0, 3) === 'ID3') return 'audio/mpeg';
      if (asc(0, 2) === '\xFF\xFB' || (b0 === 0xFF && (b1 & 0xE0) === 0xE0)) return 'audio/mpeg';
      if (asc(4, 4) === 'ftyp') return 'audio/mp4';   // MP4 容器 (m4a/m4s)
      if (asc(0, 4) === 'ftyp') return 'audio/mp4';
      if (asc(0, 4) === 'M4A ') return 'audio/mp4';
      if (asc(0, 4) === 'FORM' && asc(8, 4) === 'AIFF') return 'audio/aiff';
      return null;
    } catch (e) { return null; }
  }

  // blob -> AudioBuffer（一次性完整解码；失败自动用魔数修正 MIME 重试一次）
  function decodeAudio(blob) {
    return blob.arrayBuffer().then(function (buf) {
      function tryDecode(ab, mime) {
        var Ctx = window.OfflineAudioContext || window.AudioContext || window.webkitAudioContext;
        var ctx = new Ctx(1, 2, 44100);
        return ctx.decodeAudioData(ab);
      }
      return tryDecode(buf, blob.type).catch(function (err) {
        var real = probeMime(buf);
        if (real && real !== (blob.type || '').split(';')[0].trim().toLowerCase()) {
          log('MIME 误标修正重试：' + blob.type + ' -> ' + real);
          var fixed = new Blob([buf], { type: real });
          return tryDecode(buf, real);
        }
        throw err;
      });
    });
  }

  // 预估「整体解码后」的 PCM 占用，超阈值就避免 decode（防 OOM 整页崩溃）
  function estimateDecodedMB(blob) {
    try {
      var real = probeMime(null);
      // 从字节数按保守码率估时长：m4a 平均 ~96kbps=12KB/s，webm/ogg 更高取 8KB/s 保守
      var bytesPerSec = (real === 'audio/webm' || real === 'audio/ogg') ? 8000 : 12000;
      var durSec = blob.size / bytesPerSec;
      // PCM Float32 最坏 48kHz 双声道 = 48k*2*4 = 384KB/s
      var pcmMB = durSec * 384 / 1024;
      return Math.round(pcmMB);
    } catch (e) { return Math.round(blob.size / (1024 * 1024) * 24); }  // 兜底按 24x 估
  }
  function shouldUseRecord(blob) {
    if (SETTINGS.asrLongMode === 'record') return true;
    if (SETTINGS.asrLongMode === 'decode') return false;
    // auto：预估解码后 >1GB 或源文件 >120MB 就走播放录制，避免整页内存崩溃
    if (blob.size > 120 * 1024 * 1024) return true;
    return estimateDecodedMB(blob) > 1024;
  }
  function decodeFailReason(e, blob) {
    var m = String((e && e.message) || e);
    if (/(NotSupported|not supported|demux|format|Invalid|invalid|SyntaxError|Unable to decode)/i.test(m)) {
      return '浏览器无法解码该音频格式（' + (blob.type || '未知') + '）。已尝试播放录制兜底；若仍失败请换用最新 Chrome/Edge，或确认音频文件未损坏';
    }
    return '音频解码失败（可能内存不足）：' + m + '。已自动切换播放录制兜底';
  }

  // 把 AudioBuffer 的 [startSec, startSec+durSec) 片段重采样为 16kHz 单声道 AudioBuffer
  // 关键：createBufferSource 与 destination 同属一个 OfflineAudioContext，合法
  function renderChunk(audioBuffer, startSec, durSec, targetRate) {
    targetRate = targetRate || 16000;
    var remain = Math.max(0, audioBuffer.duration - startSec);
    var realDur = Math.min(durSec, remain);
    if (realDur <= 0) return Promise.resolve(null);
    var len = Math.max(1, Math.ceil(realDur * targetRate));
    var ctx = new OfflineAudioContext(1, len, targetRate);
    var src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(0, startSec, realDur);
    return ctx.startRendering();
  }

  function wavFromBuffer(buf) {
    if (!buf) return null;
    var sr = buf.sampleRate, len = buf.length;
    var data = new Int16Array(len);
    var ch = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var s = Math.max(-1, Math.min(1, ch[i]));
      data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    var buffer = new ArrayBuffer(44 + data.length * 2);
    var v = new DataView(buffer);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, data.length * 2, true);
    for (var j = 0; j < data.length; j++) v.setInt16(44 + j * 2, data[j], true);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // 纯文本兜底：按标点切句，在分片时间窗内均匀分布
  function splitTextByTime(text, start, end) {
    var parts = String(text).match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) || [];
    parts = parts.map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) parts = [String(text).trim()];
    var total = end - start, n = parts.length, out = [], t = start;
    for (var i = 0; i < n; i++) {
      var from = t;
      var to = (i === n - 1) ? end : from + total / n;
      out.push({ from: from, to: to, content: parts[i] });
      t = to;
    }
    return out;
  }

  var MAX_SINGLE = 40 * 1024 * 1024;   // 单次直传上限

  function fmtDur(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    return (h ? p(h, 2) + ':' : '') + p(m, 2) + ':' + p(s, 2);
  }

  // ===================== AI 语音转写（硅基流动 SenseVoice） =====================
  function sfTranscribe(blob, fileName) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('model', SETTINGS.asrModel);
      fd.append('file', blob, fileName || 'chunk.wav');
      if (SETTINGS.asrLang && SETTINGS.asrLang !== 'auto') fd.append('language', SETTINGS.asrLang);
      fd.append('response_format', 'srt');
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.siliconflow.cn/v1/audio/transcriptions',
        headers: { 'Authorization': 'Bearer ' + SETTINGS.sfKey },
        data: fd,
        timeout: 300000,
        onload: function (r) {
          if (r.status >= 200 && r.status < 300) resolve(r.responseText);
          else reject(new Error('ASR HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 160)));
        },
        onerror: function () { reject(new Error('ASR 网络错误')); },
        ontimeout: function () { reject(new Error('ASR 请求超时')); }
      });
    });
  }
  async function transcribeWav(blob, fileName) {
    var text = await sfTranscribe(blob, fileName);
    if (/^\s*\{/.test(text)) {
      try {
        var j = JSON.parse(text);
        if (j && j.error) throw new Error('ASR 接口错误：' + ((j.error.message || j.error.code) || ''));
      } catch (e) { if (e.message && e.message.indexOf('ASR 接口错误') === 0) throw e; }
    }
    return text;
  }

  function markChunk(idx, st) { if (state.asr && state.asr.chunks && state.asr.chunks[idx]) state.asr.chunks[idx].state = st; render(); }
  function updateEta(done) {
    if (!state.asr || !done) return;
    var elapsed = (Date.now() - state.asr.t0) / 1000;
    state.asr.eta = Math.round((elapsed / done) * Math.max(0, state.asr.total - done));
  }
  function finishAsr() { state.asr = null; state.loading = false; cleanupAudio(); render(); }

  function cleanupAudio() {
    state.audioBlob = null;
    state.audioBuf = null;
    try { stopRecorder(); } catch (e) {}
  }

  async function runAsr() {
    state.asrRan = true;
    if (!SETTINGS.sfKey) {
      state.err = '未配置硅基流动 API Key（⚙ 设置 → 填入 sk- 开头 Key，cloud.siliconflow.cn 获取）';
      state.loading = false; render(); return;
    }
    var ck = 'asr_' + (state.bvid || state.videoId || state.aid || state.title);
    if (cache[ck]) {
      state.body = cache[ck]; state.lan = 'ASR·缓存';
      state.loading = false; render(); toast('已使用上次转写结果'); return;
    }
    state.loading = true; state.err = '';
    state.asr = { phase: '获取音频流', done: 0, total: 0, cancel: false, progress: null, chunks: [], eta: 0, t0: Date.now() };
    render();
    try {
      var ad = state.adapter;
      var audioUrl = ad.getAudio ? await ad.getAudio() : null;
      if (!audioUrl) {
        var hint = (ad.id === 'youtube') ? 'YouTube 音频需解流媒体签名，暂不支持 AI 转写（请使用 YouTube 官方/自动字幕）'
          : (ad.id === 'html5' ? '该视频使用流媒体播放，无法直接取音频（请改用带直链视频或官方字幕的页面）' : '该站点不支持音频转写');
        throw new Error(hint);
      }
      if (state.asr && state.asr.cancel) { finishAsr(); return; }
      state.asr.phase = '下载音频'; state.asr.progress = 0; render();
      var blob = state.audioBlob || await downloadAudio(audioUrl);
      state.audioBlob = blob;
      if (state.asr && state.asr.cancel) { finishAsr(); return; }

      var body = [];

      // ① 音频不大（≤40MB）：整段直传（原始格式，不解码，快）
      if (blob.size <= MAX_SINGLE) {
        state.asr.phase = 'AI 转写（整段直传）'; state.asr.total = 1; state.asr.done = 0; render();
        try {
          var text0 = await transcribeWav(blob, 'audio.m4a');
          var segs0 = parseSrt(text0);
          var dur0 = state.duration || 0;
          if (!segs0.length) segs0 = splitTextByTime(text0, 0, dur0 || 1);
          body = segs0;
        } catch (e) {
          if (/(401|Authentication|api[ -]?key)/i.test(e.message)) throw e;
          log('整段直传失败，自动切换分片转写', e);
        }
      }

      // ② 大文件 / 直传失败：优先「整体解码分片」（秒级）；解码失败或音频超大自动降级「播放录制」（稳）
      if (!body.length) {
        var audioBuf = null;
        var useRec = shouldUseRecord(blob);
        if (!useRec) {
          state.asr.phase = '解码音频（长视频）'; state.asr.progress = null; render();
          try {
            audioBuf = state.audioBuf || await decodeAudio(blob);
            state.audioBuf = audioBuf;
          } catch (eDec) {
            if (state.asr && state.asr.cancel) { finishAsr(); return; }
            log('整体解码失败（' + decodeFailReason(eDec, blob) + '），自动降级播放录制', eDec);
            state.audioBuf = null; audioBuf = null;
            useRec = true;
          }
        }
        if (useRec) {
          // 播放录制兜底：隐藏 audio 倍速播放 + captureStream 实时重采样，内存恒定，3 小时也能转
          var recBody = await recorderAsr(blob);
          body = recBody || [];
        } else {
        var dur = audioBuf.duration || state.duration || 0;
        if (dur <= 0) throw new Error('无法获取音频时长');
        var chunkDur = Math.min(SETTINGS.asrChunkMin * 60, dur);
        var chunks = Math.max(1, Math.ceil(dur / chunkDur));
        state.asr.total = chunks; state.asr.phase = 'AI 转写（分片）';
        state.asr.chunks = [];
        for (var i = 0; i < chunks; i++) state.asr.chunks.push({ i: i, start: i * chunkDur, state: 'queued' });
        render();
        // 流水线：转写第 N 片的同时预渲染第 N+1 片（渲染快、转写慢，重叠省时间）
        var nextStart = 0;
        var next = renderChunk(audioBuf, 0, Math.min(chunkDur, dur), 16000);
        for (var i2 = 0; i2 < chunks; i2++) {
          if (state.asr && state.asr.cancel) break;
          markChunk(i2, 'working');
          var rendered = await next;
          if (i2 + 1 < chunks) {
            nextStart = (i2 + 1) * chunkDur;
            next = renderChunk(audioBuf, nextStart, Math.min(chunkDur, dur - nextStart), 16000);
          }
          if (!rendered) { markChunk(i2, 'fail'); state.asr.done = i2 + 1; updateEta(i2 + 1); render(); continue; }
          var wav = wavFromBuffer(rendered);
          var text = null;
          try {
            text = await transcribeWav(wav, 'chunk.wav');
          } catch (e) {
            if (/(size|large|exceed|limit|too\s+(big|long)|文件大小|过大|过长)/i.test(e.message)) {
              // 该片超限：对半拆小递归重转
              var sub = await splitProcess(audioBuf, i2 * chunkDur, Math.min(chunkDur, dur - i2 * chunkDur), 0);
              markChunk(i2, 'done');
              state.asr.done = i2 + 1; updateEta(i2 + 1); render();
              body = body.concat(sub);
              continue;
            }
            throw e;
          }
          var segs = parseSrt(text);
          if (!segs.length) segs = splitTextByTime(text, i2 * chunkDur, Math.min(dur, (i2 + 1) * chunkDur));
          segs.forEach(function (s) { s.from += i2 * chunkDur; s.to += i2 * chunkDur; });
          markChunk(i2, 'done');
          body = body.concat(segs);
          state.asr.done = i2 + 1; updateEta(i2 + 1); render();
        }
        }
      }

      if (state.asr && state.asr.cancel) {
        // 「保留已转写内容」要落到实处：先把已转好的片段写回界面与缓存
        if (body.length) {
          var mCancel = mergeBodies([{ body: body }]);
          mCancel.incomplete = true;
          state.body = mCancel;
          state.lan = 'ASR·取消';
          cache[ck] = mCancel;
        }
        finishAsr();
        toast(body.length ? ('已取消（保留已转写 ' + body.length + ' 句）') : '已取消');
        return;
      }
      if (!body.length) throw new Error('转写结果为空');
      var merged = mergeBodies([{ body: body }]);
      merged.incomplete = false;
      state.body = merged;
      state.lan = 'ASR·' + (SETTINGS.asrLang === 'auto' ? '自动' : (LANG_NAMES[SETTINGS.asrLang] || SETTINGS.asrLang));
      cache[ck] = merged;
      cleanupAudio();
      state.asr = null; state.loading = false; render();
      toast('已生成 ' + merged.length + ' 句转写字幕');
    } catch (e) {
      log(e);
      if (state.asr && state.asr.cancel) { finishAsr(); return; }
      cleanupAudio();
      state.err = 'AI 转写失败：' + e.message;
      state.asr = null; state.loading = false; render();
    }
  }

  // 大文件分片重试：转写失败则对半拆小递归
  async function splitProcess(audioBuf, start, dur, depth) {
    if (state.asr && state.asr.cancel) return [];
    try {
      var rendered = await renderChunk(audioBuf, start, dur, 16000);
      var wav = wavFromBuffer(rendered);
      var text = await transcribeWav(wav, 'chunk.wav');
      var s2 = parseSrt(text);
      if (!s2.length) s2 = splitTextByTime(text, start, start + dur);
      s2.forEach(function (s) { s.from += start; s.to += start; });
      return s2;
    } catch (e) {
      if (depth < 3 && dur > 300) {
        var half = dur / 2;
        var a = await splitProcess(audioBuf, start, half, depth + 1);
        var b = await splitProcess(audioBuf, start + half, half, depth + 1);
        return a.concat(b);
      }
      throw e;
    }
  }

  // ===================== 播放录制兜底通道（decode 失败 / 超大音频自动启用） =====================
  // 原理：隐藏 audio 元素按倍速播放，captureStream 捕获其输出 → 同上下文实时重采样 16kHz 单声道
  // → 攒够一片就转写（时间戳 ×倍速还原真实时间）。内存 O(单片)，与视频总长无关，3 小时也能跑。
  var recRef = { audio: null, actx: null, url: '', unlockResolve: null };
  function stopRecorder() {
    var r = recRef;
    try { if (r.audio) { r.audio.onended = null; r.audio.onpause = null; r.audio.pause(); try { r.audio.src = ''; } catch (e) {} } } catch (e) {}
    try { if (r.actx) { r.actx.close(); } } catch (e) {}
    if (r.url) { try { URL.revokeObjectURL(r.url); } catch (e) {} }
    if (r.unlockResolve) { var u = r.unlockResolve; r.unlockResolve = null; u(); }
    r.audio = null; r.actx = null; r.url = '';
  }
  function pcm16kToWav(mono16k) {
    if (!mono16k || !mono16k.length) return null;
    var fake = { sampleRate: 16000, length: mono16k.length, getChannelData: function () { return mono16k; } };
    return wavFromBuffer(fake);
  }

  async function recorderAsr(blob) {
    if (state.asr && state.asr.cancel) return [];
    var RATE = Math.max(1, Math.min(16, SETTINGS.asrPlayRate || 4));
    var chunkSecOrig = Math.min((SETTINGS.asrChunkMin || 10) * 60, 720); // 单片原时长 ≤12min，wav 体积受控
    var segsAll = [];

    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { throw new Error('当前浏览器不支持 Web Audio，无法转写'); }
    var ctx = new Ctor();
    recRef.actx = ctx;
    var audio = new Audio();
    recRef.audio = audio;
    audio.preload = 'auto';
    recRef.url = URL.createObjectURL(blob);
    audio.src = recRef.url;

    var totalDur = await new Promise(function (res) {
      var t = setTimeout(function () { res(audio.duration || 0); }, 8000);
      audio.onloadedmetadata = function () { clearTimeout(t); res(audio.duration || 0); };
      audio.onerror = function () { clearTimeout(t); res(0); };
    });
    if (!(totalDur > 0)) { stopRecorder(); throw new Error('播放器无法读取该音频（格式不受支持或文件损坏）'); }
    if (state.asr && state.asr.cancel) { stopRecorder(); return []; }
    if (typeof audio.captureStream !== 'function' && typeof audio.mozCaptureStream !== 'function' && typeof audio.msCaptureStream !== 'function') {
      stopRecorder(); throw new Error('当前浏览器不支持「播放录制」兜底，请用最新 Chrome / Edge');
    }
    var stream = audio.captureStream ? audio.captureStream() : (audio.mozCaptureStream ? audio.mozCaptureStream() : audio.msCaptureStream());
    var srcNode = ctx.createMediaStreamSource(stream);
    var proc = ctx.createScriptProcessor(16384, 2, 1);
    var inRate = ctx.sampleRate || 48000;
    var ratio = inRate / 16000;
    if (ratio < 1) ratio = 1;

    var inTotal = 0, gOut = 0, monoIn = new Float32Array(16384);
    var outParts = [], outLen = 0, outBlk = null, outBlkN = 0;
    var sliceAt = Math.max(16000, Math.round(chunkSecOrig / RATE * 16000 * 0.98)); // 攒到该样本数切一片
    var cursorOrig = 0, lastUi = 0, naturalEnd = false, stopNow = false, pending = [], consumerPromise = null, consumerErr = null;

    function takeSlice() {
      if (!outLen) return;
      var total = outLen;
      var merged = new Float32Array(total);
      var o = 0;
      for (var i = 0; i < outParts.length; i++) { merged.set(outParts[i], o); o += outParts[i].length; }
      var wavDurSec = total / 16000;
      pending.push({ samples: merged, startOrig: cursorOrig, wavDur: wavDurSec, kk: RATE });
      cursorOrig += wavDurSec * RATE;
      outParts = []; outLen = 0; outBlk = null; outBlkN = 0;
    }

    proc.onaudioprocess = function (ev) {
      try {
        var ch0 = ev.inputBuffer.getChannelData(0);
        var ch1 = ev.inputBuffer.numberOfChannels > 1 ? ev.inputBuffer.getChannelData(1) : null;
        var n = ch0.length;
        if (n !== monoIn.length) monoIn = new Float32Array(n);
        for (var i = 0; i < n; i++) monoIn[i] = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
        var localStart = inTotal;
        inTotal += n;
        if (!outBlk) outBlk = new Float32Array(Math.ceil(n / ratio) + 4);
        outBlkN = 0;
        while (true) {
          var pos = gOut * ratio;
          if (pos >= inTotal) break;
          var idx = Math.floor(pos) - localStart;
          if (idx < 0) { gOut++; continue; }
          if (idx >= n) break;
          outBlk[outBlkN++] = monoIn[idx];
          gOut++;
        }
        if (outBlkN) { outParts.push(outBlk.subarray(0, outBlkN)); outLen += outBlkN; outBlk = null; }
        if (outLen >= sliceAt) takeSlice();
        // 低频刷新 UI 进度
        var now2 = performance.now();
        if (now2 - lastUi > 800 && state.asr) {
          lastUi = now2;
          state.asr.progress = Math.max(0, Math.min(100, Math.round(audio.currentTime / totalDur * 100)));
          render();
        }
      } catch (e) { log('录制回调异常', e); }
    };

    // 串行转写消费者
    consumerPromise = (async function () {
      try {
        while (true) {
          if (state.asr && state.asr.cancel) break;
          if (!pending.length) { if (stopNow) break; await sleep(120); continue; }
          var c = pending.shift();
          if (!c || c.samples.length < 8000) continue;   // <0.5s 忽略
          if (state.asr && state.asr.cancel) break;
          state.asr.phase = '🎙 播放录制转写（' + RATE + ' 倍速）'; state.asr.progress = null;
          render();
          var wav = pcm16kToWav(c.samples);
          var txt = null;
          try {
            txt = await transcribeWav(wav, 'rec.wav');
          } catch (e) {
            if (state.asr && state.asr.cancel) break;   // 取消：本片丢弃
            if (/(size|large|exceed|limit|too\s+(big|long)|文件大小|过大|过长)/i.test(e.message) && c.samples.length > 16000 * 60) {
              try {
                var halfN = Math.floor(c.samples.length / 2);
                var segX = await transcribeWav(pcm16kToWav(c.samples.subarray(0, halfN)), 'rec.wav');
                var segY = await transcribeWav(pcm16kToWav(c.samples.subarray(halfN)), 'rec.wav');
                txt = segX + '\n' + segY;
              } catch (e2) {
                if (state.asr && state.asr.cancel) break;
                throw e2;
              }
            } else throw e;
          }
          // 网络返回后再查一次取消：被取消的切片绝不混入结果、不刷新 UI
          if (state.asr && state.asr.cancel) break;
          var segs = parseSrt(txt);
          if (!segs.length) segs = splitTextByTime(txt, c.startOrig, c.startOrig + c.wavDur * c.kk);
          segs.forEach(function (s) { s.from = c.startOrig + s.from * c.kk; s.to = c.startOrig + s.to * c.kk; });
          segsAll = segsAll.concat(segs);
          state.asr.done = (state.asr.done || 0) + 1;
          state.asr.total = Math.max(state.asr.total || 1, state.asr.done);
          render();
        }
      } catch (e) {
        // 记录真实失败原因，交给主流程提示（不静默吞掉半截结果）
        consumerErr = e;
        log('录制转写消费者异常', e);
      }
    })();

    // 启动播放（处理自动播放拦截：给一个解锁按钮）
    audio.playbackRate = RATE;
    try {
      await audio.play();
    } catch (e) {
      if (state.asr && state.asr.cancel) { stopRecorder(); return []; }
      if (!/NotAllowed|play\(\)|autoplay/i.test(String(e && e.message || e))) throw e;
      state.asr.unlock = true; state.asr.phase = '🔇 浏览器拦截自动播放，请点击「解锁播放并继续」'; render();
      await new Promise(function (res) {
        recRef.unlockResolve = res;
        var iv = setInterval(function () {
          if (state.asr && state.asr.cancel) { clearInterval(iv); if (recRef.unlockResolve === res) recRef.unlockResolve = null; res(); }
        }, 200);
      });
      if (state.asr && state.asr.cancel) { stopRecorder(); return []; }
    }

    state.asr.phase = '🎧 播放录制兜底中（' + RATE + ' 倍速，约 ' + Math.max(1, Math.round(totalDur / RATE / 60)) + ' 分钟，可最小化页面）';
    state.asr.total = Math.max(1, Math.ceil(totalDur / chunkSecOrig)); state.asr.done = 0;
    render();

    // 等播放结束或用户取消（含停滞/意外暂停兜底，避免任何路径永久挂起）
    await new Promise(function (res) {
      var lastT = -1, stallN = 0;
      audio.onended = function () { naturalEnd = true; res(); };
      audio.onpause = function () {
        // 意外暂停（非取消、非自然结束）：尝试自动恢复一次
        if (state.asr && state.asr.cancel) return;
        if (naturalEnd || audio.ended) return;
        setTimeout(function () { audio.play().catch(function () {}); }, 0);
      };
      var iv = setInterval(function () {
        if (state.asr && state.asr.cancel) { clearInterval(iv); res(); return; }
        if (naturalEnd) { clearInterval(iv); res(); return; }
        if (audio.ended || audio.currentTime >= totalDur - 0.1) { naturalEnd = true; clearInterval(iv); res(); return; }
        var t = audio.currentTime;
        if (Math.abs(t - lastT) < 0.01) { stallN++; if (stallN >= 20) { naturalEnd = true; clearInterval(iv); res(); } }
        else { stallN = 0; }
        lastT = t;
      }, 250);
    });
    try { proc.disconnect(); srcNode.disconnect(); } catch (e) {}
    takeSlice();   // 收尾：不足一片的剩余音频
    stopNow = true;
    await consumerPromise;
    if (consumerErr && !(state.asr && state.asr.cancel)) {
      toast('⚠ 播放录制中途出错（' + (consumerErr.message || consumerErr) + '），已保留成功转写部分');
    }
    // 对账：极少数浏览器 captureStream 不跟随倍速导致时间轴整体偏差 → 线性修正
    if (naturalEnd && segsAll.length && cursorOrig > totalDur * 0.5 && Math.abs(totalDur / cursorOrig - 1) > 0.05) {
      var scale = totalDur / cursorOrig;
      log('录制时间轴对账修正 ×' + scale.toFixed(3));
      segsAll.forEach(function (s) { s.from = Math.min(totalDur, s.from * scale); s.to = Math.min(totalDur, s.to * scale); });
    }
    stopRecorder();
    return segsAll;
  }

  function sfChat(prompt) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.siliconflow.cn/v1/chat/completions',
        headers: { 'Authorization': 'Bearer ' + SETTINGS.sfKey, 'Content-Type': 'application/json' },
        data: JSON.stringify({ model: SETTINGS.translateModel, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
        timeout: 180000,
        onload: function (r) {
          if (r.status >= 200 && r.status < 300) {
            try {
              var d = JSON.parse(r.responseText);
              if (d.choices && d.choices[0] && d.choices[0].message) resolve(d.choices[0].message.content || '');
              else reject(new Error('翻译响应异常'));
            } catch (e) { reject(new Error('翻译响应解析失败')); }
          } else reject(new Error('翻译 HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 160)));
        },
        onerror: function () { reject(new Error('翻译网络错误')); },
        ontimeout: function () { reject(new Error('翻译超时')); }
      });
    });
  }
  function parseTranslations(text, expected) {
    var arr = null;
    var m = String(text).match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch (e) {} }
    if (!Array.isArray(arr)) {
      arr = String(text).split(/\r?\n/).map(function (l) { return l.trim(); })
        .filter(function (l) { return l && l.indexOf('```') !== 0; })
        .map(function (c) { return { content: c }; });
    }
    return arr.slice(0, expected).map(function (x, i) {
      return { from: isFinite(x.from) ? x.from : 0, to: isFinite(x.to) ? x.to : 0, content: String(x.content == null ? '' : x.content).trim() };
    });
  }
  async function translateBody(body) {
    if (!SETTINGS.sfKey) throw new Error('翻译需要配置硅基流动 API Key');
    var targetName = LANG_NAMES[SETTINGS.translateTo] || SETTINGS.translateTo;
    var out = [], BATCH = 120;
    for (var i = 0; i < body.length; i += BATCH) {
      if (state.asr && state.asr.cancel) break;
      var batch = body.slice(i, i + BATCH);
      var prompt = '你是专业字幕翻译。把下面 JSON 数组里每条 content 翻译成' + targetName + '，要求：1) from/to 字段原样保留；2) 只翻译 content，不增删条目；3) 直接输出 JSON 数组，不要任何多余文字。\n' +
        JSON.stringify(batch.map(function (x) { return { from: x.from, to: x.to, content: x.content }; }));
      var resp = await sfChat(prompt);
      var arr = parseTranslations(resp, batch.length);
      arr.forEach(function (x, k) {
        if (!x.content) return;
        out.push({ from: batch[k].from, to: batch[k].to, content: x.content });
      });
    }
    return out.length ? out : null;
  }

  // ===================== 字幕正文获取（含站点差异） =====================
  async function fetchBody(lan) {
    var key = (state.bvid || state.videoId || state.aid || state.title) + '_' + lan;
    if (cache[key]) { state.body = cache[key]; state.lan = lan; return state.body; }
    var sub = null;
    for (var i = 0; i < state.subs.length; i++) if (state.subs[i].lan === lan) sub = state.subs[i];
    if (!sub) throw new Error('未找到该语言字幕');
    var merged;
    var ad = state.adapter;
    if (ad && ad.getSubBody) {
      merged = await ad.getSubBody(lan);   // YouTube / html5 专用解析
    } else {
      var parts = await Promise.all(sub.urls.map(function (u) {
        return gx(u, { timeout: 30000, retries: 1 }).then(JSON.parse);
      }));
      if (!parts.length) throw new Error('字幕内容为空');
      merged = mergeBodies(parts);
    }
    if (!merged || !merged.length) throw new Error('字幕内容为空');
    merged.incomplete = checkIntegrity(merged, state.duration);
    state.body = merged; state.lan = lan;
    cache[key] = merged;
    return merged;
  }

  // ===================== 主流程 =====================
  async function getSubtitles() {
    if (state.loading) return;
    state.loading = true; state.err = ''; state.noSub = false; state.asrRan = false;
    state.asr = null; render();
    try {
      var ad = detectAdapter();
      if (!ad) { state.err = '未检测到视频（请在有视频的页面使用）'; state.loading = false; render(); return; }
      state.adapter = ad;
      await ad.resolve();

      if (SETTINGS.asrForce) {
        toast('已开启「始终转写」，跳过自带字幕，直接音频转写');
        await runAsr();
        return;
      }
      if (!state.subs.length) {
        try { state.subs = await ad.fetchSubs(); }
        catch (e) {
          log('fetchSubs 失败', e);
          state.subs = [];
          if (!(SETTINGS.asrEnable || SETTINGS.asrFallback)) throw e;
        }
      }
      if (state.subs.length) {
        var lan = pickLanguage(state.subs);
        await fetchBody(lan);
        if (SETTINGS.translateTo !== 'none' && !sameLang(lan, SETTINGS.translateTo)) {
          state.asr = { phase: '翻译中', done: 0, total: Math.max(1, Math.ceil(state.body.length / 120)), cancel: false, progress: null };
          render();
          var t = await translateBody(state.body);
          if (t) { state.body = t; state.lan = lan + ' → ' + (LANG_NAMES[SETTINGS.translateTo] || SETTINGS.translateTo); }
          state.asr = null;
        }
        state.loading = false; render();
      } else if (SETTINGS.asrEnable) {
        await runAsr();
      } else {
        state.noSub = true; state.loading = false; render();
      }
    } catch (e) {
      log(e);
      if (SETTINGS.asrFallback && !state.asrRan && !state.body) {
        state.err = '';
        await runAsr();
        return;
      }
      state.err = '提取失败：' + e.message;
      state.loading = false; render();
    }
  }

  // ===================== 复制 / 下载 =====================
  function copyText(txt) {
    if (!txt) return;
    var done = function () { toast('已复制 ' + txt.replace(/\s/g, '').length + ' 字'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }
  function download(name, content, mime) {
    try {
      var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      toast('已下载 ' + name);
    } catch (e) { toast('下载失败'); }
  }

  // ===================== UI =====================
  var root = null;
  function buildUI() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'bsr-root';
    root.innerHTML =
      '<style>' +
      '#bsr-root{position:fixed;right:16px;bottom:120px;z-index:999999;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '#bsr-fab{width:52px;height:52px;border:none;border-radius:50%;background:linear-gradient(135deg,#FB7299,#FF6B9D);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 16px rgba(251,114,153,.5);transition:.15s}' +
      '#bsr-fab:hover{transform:scale(1.08)}' +
      '#bsr-panel{display:none;position:fixed;right:16px;bottom:180px;width:380px;max-height:80vh;background:#fff;color:#222;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.25);overflow:hidden;flex-direction:column}' +
      '#bsr-panel.show{display:flex}' +
      '.bsr-h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#FB7299,#FF6B9D);color:#fff;font-weight:700;font-size:14px}' +
      '.bsr-h .x{margin-left:auto;cursor:pointer;font-weight:400;opacity:.9}' +
      '.bsr-b{padding:12px 14px;overflow:auto}' +
      '.bsr-title{font-size:12px;color:#888;margin-bottom:8px;line-height:1.4;max-height:34px;overflow:hidden}' +
      '.bsr-row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}' +
      '.bsr-sel{flex:1;min-width:120px;padding:6px 8px;border:1px solid #eee;border-radius:8px;font-size:12px}' +
      '.bsr-btn{padding:8px 12px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;color:#fff}' +
      '.bsr-get{background:#FB7299;width:100%;margin-bottom:8px}' +
      '.bsr-get:disabled{opacity:.6;cursor:default}' +
      '.bsr-c{background:#7C5CBF}.bsr-t{background:#4ecca3}.bsr-s{background:#3a8ee6}.bsr-cancel{background:#e05c5c}.bsr-asr{background:#ff8f00}' +
      '.bsr-ta{width:100%;height:170px;box-sizing:border-box;border:1px solid #eee;border-radius:8px;padding:8px;font-size:12px;line-height:1.6;resize:vertical;font-family:inherit}' +
      '.bsr-st{font-size:11px;color:#999;margin:6px 0;min-height:14px;line-height:1.5}' +
      '.bsr-prog{font-size:11px;color:#3a8ee6;margin:4px 0}' +
      '.bsr-asrbox{margin:6px 0}' +
      '.bsr-bar{height:8px;border-radius:4px;background:#f0f0f0;overflow:hidden}' +
      '.bsr-barfill{height:100%;width:0%;background:linear-gradient(90deg,#FB7299,#FFB36B);transition:width .3s}' +
      '.bsr-barinfo{font-size:11px;color:#3a8ee6;margin:4px 0}' +
      '.bsr-chunks{max-height:110px;overflow:auto;font-size:10px;color:#777;line-height:1.7;background:#fafafa;border-radius:6px;padding:4px 8px;margin-top:4px}' +
      '.bsr-chunks .ok{color:#4ecca3}.bsr-chunks .run{color:#3a8ee6}.bsr-chunks .bad{color:#e05c5c}' +
      '.bsr-ops{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}' +
      '.bsr-ops .bsr-btn{flex:1;min-width:70px}' +
      '.bsr-set{margin:8px 0 4px;font-size:12px;color:#7C5CBF;cursor:pointer;user-select:none}' +
      '.bsr-setbox{display:none;border:1px solid #eee;border-radius:8px;padding:10px;margin-bottom:8px}' +
      '.bsr-setbox.show{display:block}' +
      '.bsr-setbox label{display:block;font-size:11px;color:#888;margin:8px 0 2px}' +
      '.bsr-setbox .chk{display:flex;align-items:center;gap:6px;color:#555;margin-top:8px}' +
      '.bsr-setbox .chk input{width:auto}' +
      '.bsr-setbox input[type=password],.bsr-setbox input[type=text],.bsr-setbox select{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #eee;border-radius:8px;font-size:12px}' +
      '.bsr-keywrap{position:relative}' +
      '.bsr-keywrap .eye{position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:13px;color:#999;user-select:none}' +
      '.bsr-save{width:100%;margin-top:10px;background:#7C5CBF}' +
      '#bsr-toast{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#4ecca3;color:#111;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:700;z-index:1000000;opacity:0;transition:.25s;pointer-events:none;max-width:80vw;text-align:center}' +
      '#bsr-toast.show{opacity:1}' +
      '</style>' +
      '<button id="bsr-fab" title="字幕提取">🎬</button>' +
      '<div id="bsr-panel">' +
      '  <div class="bsr-h">📝 字幕提取 <span class="x" id="bsrClose">✕</span></div>' +
      '  <div class="bsr-b">' +
      '    <div class="bsr-title" id="bsrTitle">—</div>' +
      '    <button class="bsr-btn bsr-get" id="bsrGet">⚡ 获取字幕</button>' +
      '    <div class="bsr-row" id="bsrLanRow" style="display:none">' +
      '      <select class="bsr-sel" id="bsrLan"></select>' +
      '    </div>' +
      '    <div class="bsr-st" id="bsrStatus"></div>' +
      '    <div class="bsr-prog" id="bsrProg"></div>' +
      '    <div class="bsr-asrbox" id="bsrAsrBox" style="display:none">' +
      '      <div class="bsr-bar"><div class="bsr-barfill" id="bsrBarFill"></div></div>' +
      '      <div class="bsr-barinfo" id="bsrBarInfo"></div>' +
      '      <div class="bsr-chunks" id="bsrChunks"></div>' +
      '    </div>' +
      '    <textarea class="bsr-ta" id="bsrOut" readonly placeholder="点击「获取字幕」后，字幕文字将显示在这里"></textarea>' +
      '    <div class="bsr-ops" id="bsrOps" style="display:none">' +
      '      <button class="bsr-btn bsr-c" id="bsrCopy">📋 复制</button>' +
      '      <button class="bsr-btn bsr-t" id="bsrTxt">⬇ TXT</button>' +
      '      <button class="bsr-btn bsr-s" id="bsrSrt">⬇ SRT</button>' +
      '      <button class="bsr-btn bsr-asr" id="bsrAsrBtn" style="display:none">🎙 AI 转写</button>' +
      '      <button class="bsr-btn bsr-asr" id="bsrUnlock" style="display:none">▶ 解锁播放并继续（浏览器自动播放限制）</button>' +
      '      <button class="bsr-btn bsr-cancel" id="bsrCancel" style="display:none">✖ 取消</button>' +
      '    </div>' +
      '    <div class="bsr-set" id="bsrSetToggle">⚙ 设置（AI 转写 / 翻译）</div>' +
      '    <div class="bsr-setbox" id="bsrSetBox">' +
      '      <label>硅基流动 API Key（无字幕转写 / 翻译用，cloud.siliconflow.cn 获取）</label>' +
      '      <div class="bsr-keywrap">' +
      '        <input type="password" id="bsrKey" placeholder="sk-..." autocomplete="off" />' +
      '        <span class="eye" id="bsrEye">👁</span>' +
      '      </div>' +
      '      <label class="chk"><input type="checkbox" id="bsrAsrOn" /> 无字幕时自动 AI 语音转写</label>' +
      '      <label class="chk"><input type="checkbox" id="bsrAsrFb" /> 字幕获取失败时自动转写</label>' +
      '      <label class="chk"><input type="checkbox" id="bsrAsrForce" /> 始终使用音频转写（无视自带字幕）</label>' +
      '      <label>转写语言（无字幕时）</label>' +
      '      <select id="bsrAsrLang">' +
      '        <option value="auto">自动识别</option>' +
      '        <option value="zh">中文</option>' +
      '        <option value="en">英文</option>' +
      '        <option value="ja">日文</option>' +
      '        <option value="ko">韩文</option>' +
      '        <option value="yue">粤语</option>' +
      '      </select>' +
      '      <label>转写模型</label>' +
      '      <select id="bsrAsrModel">' +
      '        <option value="FunAudioLLM/SenseVoiceSmall">SenseVoiceSmall（推荐·快）</option>' +
      '        <option value="FunAudioLLM/SenseVoiceLarge">SenseVoiceLarge（更准）</option>' +
      '      </select>' +
      '      <label>分片时长（长视频转写）</label>' +
      '      <select id="bsrChunk">' +
      '        <option value="5">5 分钟/片</option>' +
      '        <option value="10">10 分钟/片</option>' +
      '        <option value="15">15 分钟/片</option>' +
      '        <option value="20">20 分钟/片</option>' +
      '      </select>' +
      '      <label>超长视频策略（3 小时级音频防内存爆）</label>' +
      '      <select id="bsrLongMode">' +
      '        <option value="auto">自动（推荐：大音频走播放录制）</option>' +
      '        <option value="decode">始终整体解码（最快·吃内存）</option>' +
      '        <option value="record">始终播放录制（最稳·慢）</option>' +
      '      </select>' +
      '      <label>播放录制倍速（越高越快·识别率略降）</label>' +
      '      <select id="bsrPlayRate">' +
      '        <option value="2">2 倍速（最准）</option>' +
      '        <option value="4">4 倍速（推荐）</option>' +
      '        <option value="8">8 倍速（快）</option>' +
      '        <option value="16">16 倍速（极快）</option>' +
      '      </select>' +
      '      <label>翻译为（有字幕时才生效）</label>' +
      '      <select id="bsrTrans">' +
      '        <option value="none">不翻译（保留原语言）</option>' +
      '        <option value="zh">中文</option>' +
      '        <option value="en">英文</option>' +
      '        <option value="ja">日文</option>' +
      '        <option value="ko">韩文</option>' +
      '        <option value="fr">法文</option>' +
      '        <option value="de">德文</option>' +
      '        <option value="es">西班牙文</option>' +
      '        <option value="pt">葡萄牙文</option>' +
      '        <option value="ru">俄文</option>' +
      '        <option value="ar">阿拉伯文</option>' +
      '      </select>' +
      '      <label>翻译模型</label>' +
      '      <select id="bsrTModel">' +
      '        <option value="Qwen/Qwen2.5-72B-Instruct">Qwen2.5-72B（质量好）</option>' +
      '        <option value="Qwen/Qwen2.5-7B-Instruct">Qwen2.5-7B（快省）</option>' +
      '        <option value="deepseek-ai/DeepSeek-V3">DeepSeek-V3</option>' +
      '      </select>' +
      '      <button class="bsr-btn bsr-s bsr-save" id="bsrSaveSet">保存设置</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div id="bsr-toast"></div>';
    document.body.appendChild(root);

    root.querySelector('#bsr-fab').onclick = function () { root.querySelector('#bsr-panel').classList.toggle('show'); };
    root.querySelector('#bsrClose').onclick = function () { root.querySelector('#bsr-panel').classList.remove('show'); };
    root.querySelector('#bsrGet').onclick = function () { getSubtitles(); };
    root.querySelector('#bsrCopy').onclick = function () { copyText(state.body ? bodyToTxt(state.body) : getVideoInfoText()); };
    root.querySelector('#bsrTxt').onclick = function () { if (state.body) download(safeName(state.title) + (state.totalPages > 1 ? '_P' + state.page : '') + '_' + state.lan + '.txt', bodyToTxt(state.body)); };
    root.querySelector('#bsrSrt').onclick = function () { if (state.body) download(safeName(state.title) + (state.totalPages > 1 ? '_P' + state.page : '') + '_' + state.lan + '.srt', bodyToSrt(state.body), 'text/plain;charset=utf-8'); };
    root.querySelector('#bsrLan').onchange = function (e) { switchLan(e.target.value); };
    root.querySelector('#bsrCancel').onclick = function () { if (state.asr) state.asr.cancel = true; };
    root.querySelector('#bsrAsrBtn').onclick = function () { runAsr(); };
    root.querySelector('#bsrUnlock').onclick = function () {
      var a = recRef.audio;
      if (!a) return;
      a.play().then(function () {
        if (state.asr) state.asr.unlock = false;
        render();
        // 放行 recorderAsr 中等待解锁的 Promise（不释放则转写永久挂起）
        if (recRef.unlockResolve) { var u = recRef.unlockResolve; recRef.unlockResolve = null; u(); }
      }).catch(function () { toast('仍被拦截，请点击页面空白处后重试'); });
    };
    root.querySelector('#bsrSetToggle').onclick = function () { root.querySelector('#bsrSetBox').classList.toggle('show'); };
    root.querySelector('#bsrEye').onclick = function () {
      var k = root.querySelector('#bsrKey');
      k.type = (k.type === 'password') ? 'text' : 'password';
    };
    root.querySelector('#bsrSaveSet').onclick = function () {
      SETTINGS.sfKey = root.querySelector('#bsrKey').value.trim();
      SETTINGS.asrEnable = root.querySelector('#bsrAsrOn').checked;
      SETTINGS.asrFallback = root.querySelector('#bsrAsrFb').checked;
      SETTINGS.asrForce = root.querySelector('#bsrAsrForce').checked;
      SETTINGS.asrLang = root.querySelector('#bsrAsrLang').value;
      SETTINGS.asrModel = root.querySelector('#bsrAsrModel').value;
      SETTINGS.asrChunkMin = parseInt(root.querySelector('#bsrChunk').value, 10) || 10;
      SETTINGS.asrLongMode = root.querySelector('#bsrLongMode').value;
      SETTINGS.asrPlayRate = parseInt(root.querySelector('#bsrPlayRate').value, 10) || 4;
      SETTINGS.translateTo = root.querySelector('#bsrTrans').value;
      SETTINGS.translateModel = root.querySelector('#bsrTModel').value;
      saveSettings();
      toast('设置已保存');
    };
    // 回填设置
    root.querySelector('#bsrKey').value = SETTINGS.sfKey;
    root.querySelector('#bsrAsrOn').checked = SETTINGS.asrEnable;
    root.querySelector('#bsrAsrFb').checked = SETTINGS.asrFallback;
    root.querySelector('#bsrAsrForce').checked = SETTINGS.asrForce;
    root.querySelector('#bsrAsrLang').value = SETTINGS.asrLang;
    root.querySelector('#bsrAsrModel').value = SETTINGS.asrModel;
    root.querySelector('#bsrChunk').value = String(SETTINGS.asrChunkMin);
    root.querySelector('#bsrLongMode').value = SETTINGS.asrLongMode;
    root.querySelector('#bsrPlayRate').value = String(SETTINGS.asrPlayRate);
    root.querySelector('#bsrTrans').value = SETTINGS.translateTo;
    root.querySelector('#bsrTModel').value = SETTINGS.translateModel;
  }

  function render() {
    if (!root) return;
    var $ = function (id) { return root.querySelector(id); };
    $('#bsrTitle').textContent = (state.totalPages > 1 ? 'P' + state.page + (state.pageTitle ? ' ' + state.pageTitle : '') + ' · ' : '') + (state.title || '—');
    var btn = $('#bsrGet');
    if (state.loading) { btn.disabled = true; btn.textContent = '⏳ 处理中...'; }
    else { btn.disabled = false; btn.textContent = '⚡ 获取字幕'; }
    var st = $('#bsrStatus');
    if (state.err) st.textContent = '⚠️ ' + state.err;
    else if (state.loading && state.asr) st.textContent = '⏳ ' + state.asr.phase + (state.asr.total ? '（' + state.asr.done + '/' + state.asr.total + '）' : '');
    else if (state.loading) st.textContent = '正在拉取字幕...';
    else if (state.noSub) st.textContent = 'ℹ️ 本视频无字幕，点击下方「AI 转写」可语音生成字幕';
    else if (state.body) {
      var warn = state.body.incomplete ? ' ⚠️ 字幕可能不完整' : '';
      st.textContent = '✅ ' + state.body.length + ' 句 · ' + (state.lan || '') + ' · ' + bodyToTxt(state.body).replace(/\s/g, '').length + ' 字' + warn;
    } else st.textContent = '';
    var prog = $('#bsrProg');
    var box = $('#bsrAsrBox');
    if (state.asr) {
      var totalN = state.asr.total || 0;
      var doneN = state.asr.done || 0;
      var pct = 0;
      if (state.asr.progress != null) { prog.textContent = '下载进度：' + state.asr.progress + '%'; pct = state.asr.progress; }
      else if (totalN) { prog.textContent = '转写进度：' + doneN + '/' + totalN + ' 片'; pct = Math.round(doneN / totalN * 100); }
      else prog.textContent = '';
      box.style.display = 'block';
      $('#bsrBarFill').style.width = pct + '%';
      var info = [];
      if (state.asr.phase) info.push(state.asr.phase);
      if (totalN) info.push(doneN + '/' + totalN + ' 片');
      if (state.asr.eta > 0) info.push('预计剩余 ' + Math.max(1, Math.round(state.asr.eta / 60)) + ' 分钟');
      $('#bsrBarInfo').textContent = info.join(' · ');
      if (state.asr.chunks && state.asr.chunks.length) {
        $('#bsrChunks').innerHTML = state.asr.chunks.map(function (c) {
          var cls = c.state === 'done' ? 'ok' : (c.state === 'working' ? 'run' : (c.state === 'fail' ? 'bad' : ''));
          var icon = c.state === 'done' ? '✓' : (c.state === 'working' ? '⏳' : (c.state === 'fail' ? '✗' : '·'));
          return '<span class="' + cls + '">' + icon + ' ' + fmtDur(c.start) + '</span> ';
        }).join('');
        $('#bsrChunks').style.display = 'block';
      } else $('#bsrChunks').style.display = 'none';
    } else {
      prog.textContent = '';
      box.style.display = 'none';
    }
    $('#bsrOut').value = state.body ? bodyToTxt(state.body) : (state.noSub ? getVideoInfoText() : '');
    var lanRow = $('#bsrLanRow'), sel = $('#bsrLan');
    if (state.subs.length) {
      lanRow.style.display = 'flex';
      sel.innerHTML = state.subs.map(function (s) {
        return '<option value="' + s.lan + '"' + (s.lan === state.lan ? ' selected' : '') + '>' + (s.lan_doc || s.lan) + ' (' + s.lan + ')' + (s.urls.length > 1 ? ' ×' + s.urls.length + '段' : '') + (s.ai ? ' AI' : '') + '</option>';
      }).join('');
    } else lanRow.style.display = 'none';
    $('#bsrOps').style.display = 'flex';
    $('#bsrCancel').style.display = (state.asr && !state.err) ? 'inline-block' : 'none';
    // 无字幕时显示「AI 转写」按钮
    $('#bsrAsrBtn').style.display = (state.noSub || (!state.subs.length && !state.loading && !state.body)) ? 'inline-block' : 'none';
    // 播放录制被自动播放策略拦截时显示「解锁」按钮
    $('#bsrUnlock').style.display = (state.asr && state.asr.unlock) ? 'inline-block' : 'none';
  }

  async function switchLan(lan) {
    state.loading = true; render();
    try {
      await fetchBody(lan);
      if (SETTINGS.translateTo !== 'none' && !sameLang(lan, SETTINGS.translateTo)) {
        state.asr = { phase: '翻译中', done: 0, total: Math.max(1, Math.ceil(state.body.length / 120)), cancel: false, progress: null };
        render();
        var t = await translateBody(state.body);
        if (t) { state.body = t; state.lan = lan + ' → ' + (LANG_NAMES[SETTINGS.translateTo] || SETTINGS.translateTo); }
        state.asr = null;
      }
      state.loading = false; render();
    } catch (e) {
      log(e); state.err = '切换语言失败：' + e.message; state.loading = false; render();
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = root && root.querySelector('#bsr-toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  // ===================== 启动 / 视频切换检测 =====================
  function resetForNewVideo() {
    if (state.asr) state.asr.cancel = true;
    cleanupAudio();
    state.adapter = null; state.cid = null; state.videoId = '';
    state.subs = []; state.body = null; state.lan = ''; state.err = ''; state.noSub = false; state.loading = false; state.asr = null; state.asrRan = false;
    state.bvid = ''; state.aid = ''; state.title = ''; state.up = ''; state.desc = ''; state.duration = 0;
    state.page = 1; state.pageTitle = ''; state.totalPages = 1;
    var m = location.pathname.match(/BV\w+/);
    if (m) state.bvid = m[0];
    render();
    var ad = detectAdapter();
    if (ad) { state.adapter = ad; ad.resolve().then(render); }
  }

  // 站点是否值得显示 FAB（有视频 / B站 / YouTube）
  function isSupportedSite() {
    return !!(adapters.bilibili.match() || adapters.youtube.match() || adapters.html5.match());
  }

  function boot() {
    if (!isSupportedSite()) return;   // 纯文字页面不打扰
    buildUI();
    var ad = detectAdapter();
    if (ad) { state.adapter = ad; ad.resolve().then(render); }
    var last = location.href;
    // 轮询 URL 变化（SPA 切换）
    setInterval(function () {
      if (location.href !== last) { last = location.href; setTimeout(resetForNewVideo, 800); }
    }, 800);
    // YouTube SPA 导航事件
    document.addEventListener('yt-navigate-finish', function () { setTimeout(resetForNewVideo, 500); });
    // 兜底：页面里 video 元素后加载（MutationObserver 监听 video 出现）
    if (!detectAdapter()) {
      var mo = new MutationObserver(function () {
        if (isSupportedSite()) { mo.disconnect(); boot(); }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
