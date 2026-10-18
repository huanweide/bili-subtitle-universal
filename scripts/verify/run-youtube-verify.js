'use strict';

/**
 * scripts/verify/run-youtube-verify.js
 *
 * 「YouTube 与通用站点兼容性」可运行验证。
 *
 * 为什么用 fixture 而不是真网：本机 youtube.com 完全不可达（curl 返回 000），
 * 任何声称「访问了 YouTube」的结论都是假的。所以这里用 Playwright 的 page.route
 * 把发往 YouTube 的请求替换成本目录 fixtures/ 下的高仿响应，让真实脚本在真实
 * Chromium 里跑完它的 YouTube 分支——验证的是脚本代码，不是网络。
 *
 * 跑法：
 *   set NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules
 *   "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" scripts/verify/run-youtube-verify.js
 *
 * 严格只读：不修改 bili-subtitle.user.js，不写 git。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'shots');
const USERJS = fs.readFileSync(path.join(ROOT, 'bili-subtitle.user.js'), 'utf8');
const LOCAL_PORT = 8899;

if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

// ===================== 找 Chromium =====================
// 本机 ms-playwright 缓存里没有 playwright 1.64 默认要的那个 build 号，
// 直接指向已装好的 chromium（取版本号最大的那个），别触发联网下载。
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = 'C:/Users/Administrator/AppData/Local/ms-playwright';
  let best = null, bestN = -1;
  try {
    fs.readdirSync(base).forEach(function (d) {
      const m = d.match(/^chromium-(\d+)$/);
      if (!m) return;
      const n = parseInt(m[1], 10);
      const exe = path.join(base, d, 'chrome-win64', 'chrome.exe');
      if (n > bestN && fs.existsSync(exe)) { bestN = n; best = exe; }
    });
  } catch (e) {}
  return best;
}

// ===================== 本地静态服务（通用站点用例用） =====================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.ttml': 'application/xml; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};
function startServer() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      const p = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
      const fp = path.join(FIX, p);
      if (!fp.startsWith(FIX) || !fs.existsSync(fp)) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(fs.readFileSync(fp));
    });
    srv.listen(LOCAL_PORT, '127.0.0.1', function () { resolve(srv); });
  });
}

// ===================== Tampermonkey GM API 打桩 =====================
// Chromium 里没有 GM_*，脚本一上来就会 ReferenceError。这里补最小可用实现。
// GM_xmlhttpRequest 走页面内 XHR —— 这样请求仍然经过 Chromium 网络栈，
// 能被 page.route 拦到并被替换成 fixture（这是整套验证成立的前提）。
const GM_STUB = `
(function () {
  var store = {};
  var prefill = window.__BSR_PREFILL__ || {};
  Object.keys(prefill).forEach(function (k) { store[k] = prefill[k]; });
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!Object.prototype.hasOwnProperty.call(store, k)) store[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  window.__BSR_STORE__ = store;
  window.GM_getValue = function (k, d) {
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d;
  };
  window.GM_setValue = function (k, v) {
    store[k] = v;
    try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
  };
  window.GM_notification = function (o) {
    (window.__BSR_NOTIFY__ = window.__BSR_NOTIFY__ || []).push(o && (o.title + ' | ' + o.text));
  };
  window.GM_download = function (o) {
    (window.__BSR_DOWNLOADS__ = window.__BSR_DOWNLOADS__ || []).push({ name: o && o.name, url: o && o.url });
  };
  // 抓「导出」按钮生成的 Blob，用来读到带时间轴的 SRT —— 提交 {from,to,content} 三字段
  // 是否都正确的硬证据（预览区只渲染 from 与 content，to 在界面上看不到）。
  var origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) {
    (window.__BSR_BLOBS__ = window.__BSR_BLOBS__ || []).push(b);
    return origCreate(b);
  };
  window.GM_xmlhttpRequest = function (d) {
    d = d || {};
    (window.__BSR_XHR__ = window.__BSR_XHR__ || []).push((d.method || 'GET') + ' ' + d.url);
    try {
      var x = new XMLHttpRequest();
      x.open(d.method || 'GET', d.url, true);
      if (d.responseType === 'arraybuffer' || d.responseType === 'blob') x.responseType = d.responseType;
      else x.responseType = 'text';
      var h = d.headers || {};
      Object.keys(h).forEach(function (k) {
        // 浏览器禁止脚本改写的头部（Referer / User-Agent / Host ...），设了会被静默忽略并刷警告
        if (/^(referer|referrer|user-agent|host|content-length|origin|connection|cookie)$/i.test(k)) return;
        try { x.setRequestHeader(k, h[k]); } catch (e) {}
      });
      if (d.timeout) x.timeout = d.timeout;
      x.onload = function () {
        var body = (x.responseType === 'text' || x.responseType === '') ? x.responseText : x.response;
        if (d.onload) d.onload({ status: x.status, statusText: x.statusText, response: body, responseText: x.responseText, responseHeaders: x.getAllResponseHeaders(), finalUrl: d.url });
      };
      x.onerror = function () { if (d.onerror) d.onerror({ error: 'network error', finalUrl: d.url }); };
      x.ontimeout = function () { if (d.ontimeout) d.ontimeout({ error: 'timeout', finalUrl: d.url }); };
      x.onprogress = d.onprogress;
      x.send(d.data == null ? null : d.data);
    } catch (e) {
      if (d.onerror) d.onerror({ error: String(e), finalUrl: d.url });
    }
  };
})();
`;

function prefillSrc(settings) {
  return 'window.__BSR_PREFILL__ = ' + JSON.stringify(settings || {}) + ';';
}

// ===================== 路由：把 YouTube 的请求换成 fixture =====================
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;

function makeRouter(cfg, captured) {
  return async function (route) {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (e) { return route.continue(); }
    const host = u.hostname;

    // 本地静态服务：放行
    if (host === '127.0.0.1' || host === 'localhost') return route.continue();

    const isYt = YT_HOST.test(host) || host === 'youtu.be' || /googlevideo|ytimg|googleapis|ggpht/.test(host);

    // timedtext 字幕接口
    if (u.pathname.indexOf('/api/timedtext') === 0) {
      captured.push(req.url());
      if (cfg.timedtext === '403') {
        return route.fulfill({ status: 403, contentType: 'text/plain; charset=utf-8', body: 'Forbidden' });
      }
      if (cfg.timedtext === '500') {
        return route.fulfill({ status: 500, contentType: 'text/plain; charset=utf-8', body: 'boom' });
      }
      const lang = u.searchParams.get('lang') || 'zh-Hans';
      const fp = cfg.timedtext === 'comment'
        ? path.join(FIX, 'yt-timedtext-comment.ttml')
        : path.join(FIX, 'yt-timedtext-' + lang + '.ttml');
      if (!fs.existsSync(fp)) {
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no fixture for lang=' + lang });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/xml; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' },
        body: fs.readFileSync(fp)
      });
    }

    // YouTube 页面：按 cfg.html 指定 fixture（可以是文件名，也可以是「URL 片段 -> 文件名」的映射，
    // 用来给跳转前后两个 URL 喂不同的页面）
    if (isYt && cfg.html) {
      let name = null;
      if (typeof cfg.html === 'string') name = cfg.html;
      else {
        const keys = Object.keys(cfg.html);
        for (let i = 0; i < keys.length; i++) {
          if (req.url().indexOf(keys[i]) >= 0) { name = cfg.html[keys[i]]; break; }
        }
      }
      if (name) {
        const fp = path.join(FIX, name);
        if (fs.existsSync(fp)) {
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(fp) });
        }
      }
    }

    // 其它一切外部资源（图片/字体/统计/播放器脚本）：直接空响应，不让它出网
    return route.fulfill({ status: 204, body: '' });
  };
}

// ===================== 用例执行 =====================
async function runCase(browser, cfg) {
  const captured = [];
  const logs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(prefillSrc(cfg.settings));
  await ctx.addInitScript(GM_STUB);
  await ctx.addInitScript(USERJS);
  const page = await ctx.newPage();
  page.on('console', function (m) { logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', function (e) { logs.push('pageerror: ' + e.message); });
  await page.route('**/*', makeRouter(cfg, captured));

  const out = { id: cfg.id, name: cfg.name, url: cfg.url, fab: false, title: null, status: null, lines: [], count: 0, captured: captured, logs: logs, note: cfg.note || '' };

  try {
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (cfg.waitFor) {
      await page.waitForFunction(function (frag) { return location.href.indexOf(frag) >= 0; }, cfg.waitFor, { timeout: 15000 });
    }
  } catch (e) {
    out.error = 'goto 失败: ' + e.message;
    await page.screenshot({ path: path.join(SHOTS, 'yt-' + cfg.id + '.png'), fullPage: false });
    await ctx.close();
    return out;
  }
  out.finalUrl = page.url();

  try {
    await page.waitForSelector('#bsr-fab', { timeout: 10000 });
    out.fab = true;
  } catch (e) {
    out.error = '入口按钮 #bsr-fab 未出现（脚本未认领该页面）';
    await page.screenshot({ path: path.join(SHOTS, 'yt-' + cfg.id + '.png'), fullPage: false });
    await ctx.close();
    return out;
  }

  await page.evaluate(function () { document.querySelector('#bsr-fab').click(); });
  await page.waitForSelector('#bsrGet', { timeout: 5000 });
  // 等标题（resolve 已完成）
  try {
    await page.waitForFunction(function () {
      var t = document.querySelector('#bsrTitle');
      return t && t.textContent && t.textContent !== '—';
    }, { timeout: 8000 });
  } catch (e) { /* 有些场景标题就是空的，不阻塞 */ }
  out.title = await page.evaluate(function () { var t = document.querySelector('#bsrTitle'); return t ? t.textContent : null; });

  await page.evaluate(function () { document.querySelector('#bsrGet').click(); });

  let settled = false;
  try {
    await page.waitForFunction(function () {
      var st = document.querySelector('#bsrStatus');
      var t = st ? (st.textContent || '') : '';
      var n = document.querySelectorAll('#bsrOut .bsr-line').length;
      if (n > 0) return true;
      return /✅|⚠️|ℹ️/.test(t);
    }, { timeout: cfg.timeout || 25000 });
    settled = true;
  } catch (e) {
    out.error = '等待字幕结果超时（25s 内既没出字幕行也没出终态提示）';
  }
  out.settled = settled;

  out.status = await page.evaluate(function () { var s = document.querySelector('#bsrStatus'); return s ? s.textContent : null; });
  out.lines = await page.evaluate(function () {
    return Array.prototype.slice.call(document.querySelectorAll('#bsrOut .bsr-line .bsr-tx')).map(function (e) { return e.textContent; });
  });
  out.count = out.lines.length;
  out.times = await page.evaluate(function () {
    return Array.prototype.slice.call(document.querySelectorAll('#bsrOut .bsr-line .bsr-ts')).slice(0, 3).map(function (e) { return e.textContent; });
  });
  out.btn = await page.evaluate(function () { var b = document.querySelector('#bsrGet'); return b ? b.textContent : null; });
  out.notify = await page.evaluate(function () { return window.__BSR_NOTIFY__ || []; });
  out.xhr = await page.evaluate(function () { return window.__BSR_XHR__ || []; });
  out.lanOptions = await page.evaluate(function () {
    var s = document.querySelector('#bsrLan');
    if (!s) return null;
    return Array.prototype.slice.call(s.options).map(function (o) { return o.value + '=' + o.textContent; });
  });

  // 导出 SRT（带 from/to），从被截获的 Blob 里读回文本
  if (out.count) {
    try {
      await page.evaluate(function () { document.querySelector('#bsrSrt').click(); });
      await page.waitForTimeout(300);
      out.srt = await page.evaluate(async function () {
        var arr = window.__BSR_BLOBS__ || [];
        var b = arr[arr.length - 1];
        if (!b) return null;
        return await b.text();
      });
    } catch (e) { out.srt = 'SRT 抓取失败: ' + e.message; }
  }

  // 切换语言（多轨道场景）
  if (cfg.switchLan) {
    try {
      await page.selectOption('#bsrLan', cfg.switchLan);
      await page.waitForFunction(function () {
        var st = document.querySelector('#bsrStatus');
        var t = st ? (st.textContent || '') : '';
        return /✅|⚠️|ℹ️/.test(t);
      }, { timeout: 20000 });
      out.switchStatus = await page.evaluate(function () { var s = document.querySelector('#bsrStatus'); return s ? s.textContent : null; });
      out.switchLines = await page.evaluate(function () {
        return Array.prototype.slice.call(document.querySelectorAll('#bsrOut .bsr-line .bsr-tx')).map(function (e) { return e.textContent; });
      });
      out.switchCaptured = captured.slice();
      await page.screenshot({ path: path.join(SHOTS, 'yt-' + cfg.id + '-after-switch.png'), fullPage: false });
    } catch (e) { out.switchError = String(e.message).split('\n')[0]; }
  }

  await page.screenshot({ path: path.join(SHOTS, 'yt-' + cfg.id + '.png'), fullPage: false });
  await ctx.close();
  return out;
}

// ===================== 用例表 =====================
// settings 说明：默认把 ASR 关掉，隔离「字幕抓取」这条链路本身；
// 受限场景再另开一条用默认设置（asrFallback=true）跑，看真实用户看到什么。
const ASR_OFF = { bsr_asr_enable: false, bsr_asr_fallback: false, bsr_asr_force: false, bsr_translate_to: 'none', bsr_auto_fetch: false };
const ASR_DEFAULT = { bsr_asr_enable: true, bsr_asr_fallback: true, bsr_asr_force: false, bsr_translate_to: 'none', bsr_auto_fetch: false };

const CASES = [
  { id: '01-watch', name: 'YouTube 观看页 watch?v=：识别 + 抽轨 + 取字幕 + 渲染 + 切英文轨',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html: 'yt-watch.html', settings: ASR_OFF, switchLan: 'en' },
  { id: '02-embed', name: 'YouTube 嵌入播放器 /embed/',
    url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', html: 'yt-embed.html', settings: ASR_OFF },
  { id: '03-shorts', name: 'YouTube Shorts /shorts/',
    url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', html: 'yt-shorts.html', settings: ASR_OFF },
  { id: '04-live', name: 'YouTube 直播 /live/',
    url: 'https://www.youtube.com/live/dQw4w9WgXcQ', html: 'yt-live.html', settings: ASR_OFF },
  { id: '05-nocookie', name: '隐私增强嵌入 youtube-nocookie.com/embed/',
    url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', html: 'yt-nocookie-embed.html', settings: ASR_OFF },
  { id: '06a-youtube-be-redirect', name: 'youtu.be 短链：跳到 watch 后的最终表现（客户端跳转版）',
    url: 'https://youtu.be/dQw4w9WgXcQ', waitFor: '/watch', settings: ASR_OFF,
    html: { 'youtu.be': 'yt-youtu-be-redirect.html', '/watch': 'yt-watch.html' },
    note: '真实 youtu.be 是服务端 303；Playwright fulfill 的 303 Chromium 不跟随，故用等价的 location.replace 跨源跳转' },
  { id: '06b-youtube-be-hold', name: 'youtu.be 短链：停在短链页（重定向尚未发生）时的表现',
    url: 'https://youtu.be/dQw4w9WgXcQ', html: 'yt-youtu-be.html', settings: ASR_OFF },
  { id: '07-stale', name: 'SPA 陈旧 playerResponse：地址栏 ID 与 playerResponse 不一致',
    url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', html: 'yt-watch.html', settings: ASR_OFF,
    note: '地址栏是 bbbbbbbbbbb，页面里 playerResponse.videoId 仍是 dQw4w9WgXcQ' },
  { id: '08-restricted-reason', name: '受限视频：playabilityStatus.reason 存在、无 captions',
    url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', html: 'yt-watch-restricted.html', settings: ASR_OFF },
  { id: '09-captions-403', name: '字幕接口 403（关 ASR 回退，隔离报错本身）',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html: 'yt-watch.html', timedtext: '403', settings: ASR_OFF },
  { id: '10-captions-403-default', name: '字幕接口 403（默认设置，asrFallback 开）',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html: 'yt-watch.html', timedtext: '403', settings: ASR_DEFAULT },
  { id: '11-generic-vtt', name: '通用站点：<video> + <track kind=captions src=*.vtt>',
    url: 'http://127.0.0.1:' + LOCAL_PORT + '/generic-track.html', settings: ASR_OFF },
  { id: '12-generic-texttracks', name: '通用站点：JS 挂的 video.textTracks 内存轨道',
    url: 'http://127.0.0.1:' + LOCAL_PORT + '/generic-texttracks.html', settings: ASR_OFF },
  { id: '13-watch-nopolish', name: 'YouTube watch（关掉「字幕增强」，看解析出来的原始条数）',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html: 'yt-watch.html',
    settings: Object.assign({}, ASR_OFF, { bsr_polish_on: false }) },
  { id: '14-generic-vtt-nopolish', name: '通用站点 WebVTT（关掉「字幕增强」，看原始条数）',
    url: 'http://127.0.0.1:' + LOCAL_PORT + '/generic-track.html',
    settings: Object.assign({}, ASR_OFF, { bsr_polish_on: false }) },
  { id: '16-restricted-default', name: '受限视频（默认设置，asrEnable/asrFallback 开）',
    url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', html: 'yt-watch-restricted.html', settings: ASR_DEFAULT },
  { id: '15-ttml-comment', name: 'TTML 带 XML 注释（看 parseTtml 会不会把注释里的示例也读成字幕）',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html: 'yt-watch.html', timedtext: 'comment',
    settings: Object.assign({}, ASR_OFF, { bsr_polish_on: false }) }
];

(async function main() {
  const srv = await startServer();
  const exe = findChromium();
  if (!exe) throw new Error('没找到可用的 Chromium，请设置 PLAYWRIGHT_CHROMIUM 指向 chrome.exe');
  console.log('Chromium: ' + exe + '\n');
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const results = [];
  for (const c of CASES) {
    process.stdout.write('[' + c.id + '] ' + c.name + ' … ');
    const r = await runCase(browser, c);
    results.push(r);
    console.log(r.count ? 'OK ' + r.count + ' 行' : (r.error ? 'ERR ' + r.error : '0 行 / ' + r.status));
  }
  await browser.close();
  srv.close();
  fs.writeFileSync(path.join(__dirname, 'verify-results.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n结果已写入 scripts/verify/verify-results.json');
})().catch(function (e) { console.error(e); process.exit(1); });
