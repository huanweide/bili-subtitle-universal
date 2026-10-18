/**
 * bili-subtitle-universal · 浏览器真机验证
 * 只负责观察与取证，不修改仓库源码。
 *
 * 用法：
 *   NODE_PATH=<托管 workspace>/node_modules node scripts/verify/browser-verify.js
 *   node browser-verify.js --real-only   // 只跑真网场景
 *   node browser-verify.js --video BVxxx
 *
 * 架构：
 *   1. page.exposeFunction('__bsrFetch') 把网络能力接到 Node 侧（Node fetch 无同源限制），
 *      因此 Tampermonkey 的 GM_xmlhttpRequest 由 Node 代跑 —— 请求是**真请求**。
 *   2. addInitScript 注入 GM_* 打桩（value/get/set/notification/download/xmlhttpRequest）。
 *   3. 真实 bilibili 视频页加载后 evaluate 主脚本源码（模拟 @run-at document-idle）。
 *   4. FIXTURE=1 时，在 Node 路由层把「真实 player/wbi/v2 响应」里的 subtitle.subtitles
 *      补成一条字幕轨（其余字段全真），字幕 JSON 走 fixture。
 *      这样做的目的是绕开"未登录账号拿不到字幕轨"的环境限制，脚本本身代码路径完全没改。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = path.join(__dirname, 'shots');
const USER_JS = path.join(ROOT, 'bili-subtitle.user.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const VIDEO = arg('--video', 'BV1GJ411x7h7');
const ONLY_REAL = process.argv.includes('--real-only');

// ---------------- fixture：结构与真实 B 站字幕 JSON 完全一致（body[].from/to/location/content） -------------
const FIXTURE_SUB_URL = 'https://i0.hdslb.com/bfs/subtitle/browser-verify-fixture.json';
const FIXTURE_SUB = {
  font_size: 0.4,
  font_color: '#FFFFFF',
  background_alpha: 0.5,
  background_color: '#9C27B0',
  Stroke: 'none',
  type: 'AIsubtitle',
  lang: 'zh-CN',
  version: 'v1.6.0.1',
  body: [
    { from: 1.02, to: 4.35, location: 2, content: '大家好，这一期我们来讲字幕提取到底是怎么做的。' },
    { from: 4.35, to: 8.10, location: 2, content: '先说结论：有官方字幕就直接拉官方字幕，没有才用语音转写。' },
    { from: 8.10, to: 12.66, location: 2, content: 'B 站的字幕接口需要 WBI 签名，丢了签名会被风控拦掉。' },
    { from: 12.66, to: 17.20, location: 2, content: '拿到字幕地址之后是一个 JSON，里面每一条都有起止时间和正文。' },
    { from: 17.20, to: 22.05, location: 2, content: '我们把这些条目渲染成可以点击的行，点一下就跳到视频对应位置。' },
    { from: 22.05, to: 27.40, location: 2, content: '导出支持 TXT、SRT、VTT、Markdown 和 AI 纯文本五种。' },
    { from: 27.40, to: 32.80, location: 2, content: '最后提醒一句：预览区看得见文字，才算真的取到了字幕。' },
    { from: 32.80, to: 38.11, location: 2, content: '不然状态栏说几句 успешно 也没用，眼睛是骗不了人的。' },
    { from: 38.11, to: 43.60, location: 2, content: '这一句是特意混进来的俄文单词，用来验证渲染有没有丢字符。' },
    { from: 43.60, to: 49.02, location: 2, content: '十条足够了，再多的部分交给真正的线上数据去检验。' }
  ]
};

// ---------------- Node 侧网络 ----------------
let FIXTURE = 0;   // 0=纯真网  1=真网+注入字幕轨(fixture 字幕 JSON)  2=把 nav 的 code 改成 0（解锁脚本 WBI 分支）+纯真网
const netLog = [];

async function nodeFetch(o) {
  const { url, method = 'GET', headers = {}, data = null, timeout = 15000, responseType = 'text' } = o;
  const isSubJson = FIXTURE === 1 && url === FIXTURE_SUB_URL;
  const needInject = FIXTURE === 1 && /\/x\/player\/(wbi\/)?v2\?/.test(url);
  const patchNav = FIXTURE === 2 && /\/x\/web-interface\/nav(\?|$)/.test(url);

  if (isSubJson) {
    netLog.push({ url, mode: 'fixture', len: JSON.stringify(FIXTURE_SUB).length });
    return { status: 200, text: JSON.stringify(FIXTURE_SUB), headers: 'content-type: application/json' };
  }
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), Math.min(timeout + 5000, 40000));
  try {
    const r = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', ...headers },
      body: data == null ? undefined : data,
      signal: ac.signal,
      redirect: 'follow'
    });
    let text = null, b64 = null;
    if (responseType === 'arraybuffer' || responseType === 'blob') {
      const buf = Buffer.from(await r.arrayBuffer());
      text = buf.toString('utf8');
      b64 = buf.toString('base64');
    } else {
      text = await r.text();
    }
    if (patchNav && r.status === 200) {
      try {
        const j = JSON.parse(text);
        netLog.push({ url, mode: 'real+nav改写', 原始code: j.code, 有wbi_img: !!(j.data && j.data.wbi_img) });
        if (j.code !== 0 && j.data && j.data.wbi_img) {
          j.code = 0; j.message = '0';
          text = JSON.stringify(j);
        } else {
          return { status: 200, text, headers: 'content-type: application/json' };
        }
        return { status: 200, text, headers: 'content-type: application/json' };
      } catch (e) { /* ignore */ }
    }
    if (/\/x\/player\/wbi\/v2\?/.test(url)) {
      try {
        const j = JSON.parse(text);
        netLog.push({
          url: url.split('?')[0], mode: 'real(脚本自带WBI签名)', 带w_rid: /[&?]w_rid=/.test(url),
          code: j.code, message: j.message, 字幕轨: ((j.data || {}).subtitle || {}).subtitles ? j.data.subtitle.subtitles.length : null,
          need_login_subtitle: (j.data || {}).need_login_subtitle
        });
      } catch (e) { /* ignore */ }
    }
    if (needInject && r.status === 200) {
      try {
        const j = JSON.parse(text);
        if (j && j.code === 0 && j.data) {
          const before = (j.data.subtitle && j.data.subtitle.subtitles || []).length;
          j.data.subtitle = {
            allow_submit: false, lan: '', lan_doc: '', subtitle_position: null, font_size_type: 0,
            subtitles: [{
              id: 999999, lan: 'zh-CN', lan_doc: '中文（中国大陆）',
              is_lock: false, subtitle_url: '//i0.hdslb.com/bfs/subtitle/browser-verify-fixture.json',
              type: 1, id_str: '999999', ai_status: 0, ai_type: 0, machine_generated: true
            }]
          };
          j.data.need_login_subtitle = false;
          text = JSON.stringify(j);
          netLog.push({ url: url.split('?')[0], mode: 'real+fixture注入', 真实字幕轨数: before, 注入后: 1 });
          return { status: 200, text, b64: Buffer.from(text).toString('base64'), headers: 'content-type: application/json' };
        }
      } catch (e) { /* 非 JSON，原样返回 */ }
    }
    netLog.push({ url: url.slice(0, 130), mode: 'real', status: r.status, len: (text || '').length });
    return { status: r.status, text, b64, headers: String(r.headers.get('content-type') || '') };
  } catch (e) {
    netLog.push({ url: url.slice(0, 130), mode: 'real', error: String(e && e.message || e) });
    return { status: 0, error: String(e && e.message || e), text: '', b64: null };
  } finally {
    clearTimeout(tm);
  }
}

// ---------------- GM 打桩（页面侧） ----------------
function gmStubSource() {
  return function () {
    var KEY = '__bsrStore';
    function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
    function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { } }
    window.__bsrXhrLog = [];
    window.__bsrNotify = [];
    window.__bsrDownload = [];
    window.GM_getValue = function (k, d) { var o = load(); return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : d; };
    window.GM_setValue = function (k, v) { var o = load(); o[k] = v; save(o); };
    window.GM_notification = function (o) { window.__bsrNotify.push(o); };
    window.GM_download = function (o) { window.__bsrDownload.push({ url: o && o.url, name: o && o.name, len: o && o.data ? String(o.data).length : 0 }); };
    window.GM_xmlhttpRequest = function (opts) {
      var noop = function () { };
      var rec = { url: opts.url, method: opts.method || 'GET', responseType: opts.responseType || 'text', t0: Date.now() };
      Promise.resolve().then(function () {
        return window.__bsrFetch({
          url: opts.url, method: opts.method || 'GET', headers: opts.headers || {},
          data: opts.data == null ? null : String(opts.data), timeout: opts.timeout || 10000,
          responseType: opts.responseType || 'text'
        });
      }).then(function (res) {
        rec.status = res.status; rec.ms = Date.now() - rec.t0; rec.len = (res.text || '').length; rec.err = res.error || null;
        window.__bsrXhrLog.push(rec);
        if (res.error) { (opts.onerror || noop)({ error: res.error }); return; }
        var resp = res.text == null ? '' : res.text;
        if ((opts.responseType === 'arraybuffer' || opts.responseType === 'blob') && res.b64) {
          try {
            var bin = atob(res.b64), arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            resp = arr.buffer;
          } catch (e) { resp = null; }
        }
        (opts.onload || noop)({
          status: res.status, response: resp, responseText: res.text,
          responseHeaders: res.headers || '', finalUrl: opts.url
        });
      }).catch(function (e) {
        rec.err = String(e); window.__bsrXhrLog.push(rec);
        (opts.onerror || noop)({ error: String(e) });
      });
    };
    // 预置设置：关掉 ASR 相关，避免误烧额度 / 避免没有 API Key 时跑偏
    var o = load();
    ['bsr_asr_enable', 'bsr_asr_fallback', 'bsr_asr_force'].forEach(function (k) { if (!(k in o)) o[k] = false; });
    if (!('bsr_click_seek' in o)) o.bsr_click_seek = true;
    if (!('bsr_export_mode' in o)) o.bsr_export_mode = 'copy';
    save(o);

    // 抓导出内容：download() 走 Blob + <a download>，不经过 GM_download，
    // 所以在 createObjectURL 处截获，才能客观验证导出文件里真的有字。
    window.__bsrBlobs = [];
    var origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      try {
        blob.text().then(function (t) {
          window.__bsrBlobs.push({ size: blob.size, type: blob.type, head: t.slice(0, 300), full: t });
        });
      } catch (e) { }
      return origCreate(blob);
    };
  };
}

// ---------------- 页面 DOM 断言助手（在浏览器里跑） ----------------
const DUMP = () => {
  const root = document.getElementById('bsr-root');
  const out = root && root.querySelector('#bsrOut');
  const lines = out ? Array.from(out.querySelectorAll('.bsr-line')) : [];
  return {
    panelExists: !!root,
    fabExists: !!(root && root.querySelector('#bsr-fab')),
    status: root ? (root.querySelector('#bsrStatus') || {}).textContent : null,
    title: root ? (root.querySelector('#bsrTitle') || {}).textContent : null,
    lineCount: lines.length,
    hitCount: lines.filter(l => l.classList.contains('hit')).length,
    emptyTxCount: lines.filter(l => !(l.querySelector('.bsr-tx') || {}).textContent?.trim()).length,
    texts: lines.slice(0, 3).map(l => (l.querySelector('.bsr-tx') || {}).textContent),
    stamps: lines.slice(0, 3).map(l => (l.querySelector('.bsr-ts') || {}).textContent),
    tsAllMatchFormat: lines.length ? lines.every(l => /^\d{1,2}:\d{2}(:\d{2})?$/.test(((l.querySelector('.bsr-ts') || {}).textContent || '').trim())) : false,
    axisToggleDisplay: root && root.querySelector('#bsrAxisToggle') ? getComputedStyle(root.querySelector('#bsrAxisToggle')).display : null,
    findRowDisplay: root && root.querySelector('#bsrFindRow') ? getComputedStyle(root.querySelector('#bsrFindRow')).display : null,
    opsDisplay: root && root.querySelector('#bsrOps') ? getComputedStyle(root.querySelector('#bsrOps')).display : null,
    autoFetchExists: !!(root && root.querySelector('#bsrAutoFetch')),
    autoFetchChecked: root && root.querySelector('#bsrAutoFetch') ? root.querySelector('#bsrAutoFetch').checked : null,
    setToggleExists: !!(root && root.querySelector('#bsrSetToggle'))
  };
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const src = fs.readFileSync(USER_JS, 'utf8');
  console.log('主脚本读取:', src.length, 'bytes');

  // 拿真实 cookie（buvid3 / b_nut）
  const home = await fetch('https://www.bilibili.com/', { headers: { 'User-Agent': UA } });
  const cookies = home.headers.getSetCookie().map(c => c.split(';')[0])
    .filter(c => /^(buvid3|b_nut|b_lsid|CURRENT_FNVAL)=/.test(c))
    .map(c => { const [n, v] = c.split('='); return { name: n, value: v, domain: '.bilibili.com', path: '/' }; });
  console.log('注入 cookie:', cookies.map(c => c.name).join(','));

  // 本机 ms-playwright 缓存里最高版本是 chromium-1234，而 playwright 1.64 期望 1248，故显式指定 executablePath
  const CHROME = arg('--chrome', process.env.LOCALAPPDATA + '/ms-playwright/chromium-1234/chrome-win64/chrome.exe');
  const launchOpts = {
    headless: true,
    executablePath: CHROME,
    args: ['--disable-blink-features=AutomationControlled', '--autoplay-policy=no-user-gesture-required', '--mute-audio']
  };
  console.log('浏览器可执行:', CHROME, '存在 =', fs.existsSync(CHROME));
  const browser = await chromium.launch(launchOpts);

  const MODE = { real: 0, fixture: 1, wbi: 2 };
  const scenarios = ONLY_REAL ? ['real'] : ['real', 'wbi', 'fixture'];
  const report = { video: VIDEO, scenarios: {}, netLog: [] };

  for (const sc of scenarios) {
    FIXTURE = MODE[sc];
    netLog.length = 0;
    console.log('\n========== 场景 ' + sc.toUpperCase() + ' (FIXTURE=' + FIXTURE + ') ==========');
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: UA,
      locale: 'zh-CN',
      permissions: ['clipboard-read', 'clipboard-write']
    });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    const consoleMsgs = [];
    page.on('console', m => {
      const t = m.text();
      consoleMsgs.push('[' + m.type() + '] ' + t.slice(0, 300));
      if (/全网字幕|BSR/.test(t)) console.log('  [页面日志]', t.slice(0, 200));
    });
    page.on('pageerror', e => console.log('  [页面异常]', String(e).slice(0, 200)));

    await page.exposeFunction('__bsrFetch', nodeFetch);
    await page.addInitScript(gmStubSource());

    const url = 'https://www.bilibili.com/video/' + VIDEO;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);

    const r = { before: null, after: null };
    r.hostname = await page.evaluate(() => location.hostname);
    r.hasNativeVideo = await page.evaluate(() => document.querySelectorAll('video').length);

    // 注入主脚本
    await page.evaluate(src);
    await page.waitForTimeout(1500);
    r.panelInjected = await page.evaluate(() => !!document.getElementById('bsr-root'));
    if (!r.panelInjected) { console.log('  ✗ 面板未注入'); await ctx.close(); continue; }

    // 打开面板：点胶囊
    await page.click('#bsr-fab').catch(() => { });
    await page.waitForTimeout(600);
    r.before = await page.evaluate(DUMP);

    // 点「获取字幕」
    await page.click('#bsrGet');
    await page.waitForFunction(() => {
      const s = document.querySelector('#bsrStatus');
      if (!s) return false;
      const t = s.textContent || '';
      if (/处理中|正在拉取/.test(t)) return false;
      return t.trim().length > 0;
    }, { timeout: 45000 }).catch(() => console.log('  [超时] 状态栏一直停留在进行态'));
    await page.waitForTimeout(1200);
    r.after = await page.evaluate(DUMP);
    r.xhrLog = await page.evaluate(() => window.__bsrXhrLog);
    r.notify = await page.evaluate(() => window.__bsrNotify);
    r.console = consoleMsgs;

    console.log('  状态栏:', JSON.stringify(r.after.status));
    console.log('  .bsr-line 行数:', r.after.lineCount, '| 空正文行:', r.after.emptyTxCount);
    console.log('  前 3 条正文:', JSON.stringify(r.after.texts));
    console.log('  前 3 条时间戳:', JSON.stringify(r.after.stamps));
    console.log('  GM_xmlhttpRequest 调用:', r.xhrLog.map(x => x.method + ' ' + x.url.slice(0, 90) + ' -> ' + x.status + ' ' + (x.len || 0) + 'B').join('\n      '));

    // ---------- 截图 ----------
    await page.screenshot({ path: path.join(SHOTS, `browser-01-panel-${sc}.png`) });
    await page.locator('#bsr-out-wrap, #bsrOut').first().screenshot({ path: path.join(SHOTS, `browser-02-preview-${sc}.png`) }).catch(async () => {
      await page.locator('#bsrOut').screenshot({ path: path.join(SHOTS, `browser-02-preview-${sc}.png`) });
    });
    if (sc === 'fixture' && r.after.lineCount > 0) {
      // 全页面 re-shoot 带字幕
      await page.screenshot({ path: path.join(SHOTS, 'browser-01-panel.png') });
      await page.locator('#bsrOut').screenshot({ path: path.join(SHOTS, 'browser-02-preview.png') });
    }

    if (sc === 'fixture' && r.after.lineCount > 0) {
      // ---------- 点击行跳转 ----------
      const seek = await page.evaluate(async () => {
        const vids = Array.from(document.querySelectorAll('video'));
        const v = vids[0];
        const line = document.querySelectorAll('#bsrOut .bsr-line')[3];
        if (!v || !line) return { ok: false, reason: !v ? '页面无 <video>' : '无字幕行' };
        const want = Number(line.getAttribute('data-from'));
        try { v.pause(); } catch (e) { }
        await new Promise(r => setTimeout(r, 400));
        const before = v.currentTime;
        try { if (v.paused) await v.play().catch(() => { }); } catch (e) { }
        try { v.pause(); } catch (e) { }
        line.click();
        await new Promise(r => setTimeout(r, 1200));
        return {
          ok: true, readyState: v.readyState, paused: v.paused, before, after: v.currentTime, want,
          delta: +(v.currentTime - want).toFixed(3),
          curClass: line.classList.contains('cur'),
          toast: (document.getElementById('bsr-toast') || {}).textContent
        };
      });
      r.seek = seek;
      console.log('  点击第 4 行跳转:', JSON.stringify(seek));

      // ---------- 检索 ----------
      const before = r.after.lineCount;
      await page.fill('#bsrFind', '字幕');
      await page.waitForTimeout(900);
      const s1 = await page.evaluate(DUMP);
      // 检索生效时「复制」是否只出命中行
      await page.click('#bsrCopy');
      await page.waitForTimeout(600);
      const clipHit = await page.evaluate(async () => {
        try {
          const t = await navigator.clipboard.readText();
          return { lines: t.split(/\r?\n/).filter(Boolean).length, text: t };
        } catch (e) { return { error: String(e).slice(0, 100) }; }
      });
      const findInfo = await page.evaluate(() => {
        const e = document.getElementById('bsrFindInfo');
        return { display: e ? getComputedStyle(e).display : null, text: e ? e.textContent : null };
      });
      await page.fill('#bsrFind', 'полный-不存在的词');
      await page.waitForTimeout(900);
      const s2 = await page.evaluate(DUMP);
      await page.fill('#bsrFind', '');
      await page.waitForTimeout(600);
      const s3 = await page.evaluate(DUMP);
      r.search = { before, kw: s1.lineCount, hit: s1.hitCount, texts: s1.texts, nonsense: s2.lineCount, cleared: s3.lineCount, findInfo, clipHit };
      console.log('  检索「字幕」后行数:', s1.lineCount, '（原', before, '）命中高亮:', s1.hitCount, '| 无意义词后:', s2.lineCount, '| 清空后:', s3.lineCount);
      console.log('  检索命中时「复制」:', clipHit.lines, '行 | 提示:', JSON.stringify(findInfo.text));

      // ---------- 设置面板 ----------
      await page.click('#bsrSetToggle');
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        const root = document.getElementById('bsr-root');
        const target = root.querySelector('#bsrAutoFetch');
        const sc = root.querySelector('.bsr-b');   // 面板内部真正的滚动容器
        if (sc && target) {
          const a = target.getBoundingClientRect(), b = sc.getBoundingClientRect();
          sc.scrollTop += (a.top - b.top) - 130;
        }
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SHOTS, 'browser-03-settings.png') });
      await page.locator('#bsr-panel').screenshot({ path: path.join(SHOTS, 'browser-03-settings-box.png') }).catch(e => console.log('  [截图] 设置面板失败:', String(e).slice(0, 80)));
      const st = await page.evaluate(() => {
        const root = document.getElementById('bsr-root');
        const box = root.querySelector('#bsrSetBox');
        const af = root.querySelector('#bsrAutoFetch');
        return {
          boxDisplay: box ? getComputedStyle(box).display : null,
          autoFetchExists: !!af, autoFetchChecked: af ? af.checked : null,
          autoFetchLabel: af ? (af.closest('label') || af.parentElement || {}).innerText : null,
          settingIds: Array.from(box ? box.querySelectorAll('[id]') : []).map(e => e.id).slice(0, 40)
        };
      });
      r.settings = st;
      console.log('  设置面板 display:', st.boxDisplay, '| 「进入视频自动获取字幕」:', st.autoFetchExists, 'checked =', st.autoFetchChecked);

      // ---------- 导出（SRT）取内容 ----------
      const exp = await page.evaluate(() => {
        const root = document.getElementById('bsr-root');
        const lines = Array.from(root.querySelectorAll('#bsrOut .bsr-line'));
        return lines.slice(0, 4).map(l => l.querySelector('.bsr-ts').textContent + '  ' + l.querySelector('.bsr-tx').textContent).join('\n');
      });
      r.exportPreview = exp;

      // ---------- 复制到剪贴板 ----------
      await page.click('#bsrCopy');
      await page.waitForTimeout(700);
      r.clipboard = await page.evaluate(async () => {
        try { const t = await navigator.clipboard.readText(); return { len: t.length, head: t.slice(0, 100) }; }
        catch (e) { return { error: String(e).slice(0, 120) }; }
      });
      r.toast = await page.evaluate(() => (document.getElementById('bsr-toast') || {}).textContent);

      // ---------- SRT 导出内容 ----------
      await page.click('#bsrSrt');
      await page.waitForTimeout(900);
      r.srtBlob = await page.evaluate(() => {
        const list = (window.__bsrBlobs || []).filter(b => /text|vtt|markdown/i.test(b.type || ''));
        const b = list[list.length - 1];
        return b ? { size: b.size, type: b.type, head: b.full.slice(0, 300) } : { none: (window.__bsrBlobs || []).map(x => x.type) };
      });

      await page.locator('#bsrOps').screenshot({ path: path.join(SHOTS, 'browser-04-export.png') }).catch(() => { });
      fs.writeFileSync(path.join(SHOTS, 'dom-lines.txt'), await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#bsrOut .bsr-line'))
          .map(l => l.querySelector('.bsr-ts').textContent + '\t' + l.querySelector('.bsr-tx').textContent).join('\n');
      }), 'utf8');
    }

    report.scenarios[sc] = r;
    report.netLog.push({ scenario: sc, log: netLog.slice() });
    await ctx.close();
  }

  fs.writeFileSync(path.join(__dirname, 'browser-verify-result.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\n结果已写入 scripts/verify/browser-verify-result.json');
  await browser.close();
})().catch(e => { console.error('致命错误:', e); process.exit(1); });
