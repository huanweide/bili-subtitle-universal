'use strict';

/**
 * 站点与页面形态识别（v9.8）。
 *
 * 背景：适配器的 match() 是三条各自为政的正则，散在主脚本里，加一个站要改三处，
 * 改完还没测试。结果是「B 站嵌入播放器」「稍后再看 / 收藏夹 / 合集」这些真实存在的
 * 页面形态根本不认——用户在博客里看到嵌的 B 站视频，右下角一个按钮都没有，
 * 脚本等于不存在。
 *
 * 这里把「哪些 URL 我们认领」集中成一张表 + 纯函数，加站 = 加一行，且有测试兜底。
 *
 * 设计约束：
 * 1. 纯函数，不碰 location / document——Node 里能完整测试。
 * 2. 只认领「确实能拿到字幕」的形态。认领了却取不到，比不认领更伤信任
 *    （所以直播回放、番剧详情页这种没有播放器/没有字幕的形态一律不认）。
 * 3. 解析失败返回 null，绝不抛异常。
 */
function createSiteMatchModule() {
  // id：交给哪个适配器；form：页面形态（日志与测试用）
  var RULES = [
    // —— B 站 ——
    { id: 'bilibili', form: 'video', host: /(^|\.)bilibili\.com$/i, path: /^\/video\/BV[0-9A-Za-z]+/i, note: '普通视频（含多 P）' },
    { id: 'bilibili', form: 'video-av', host: /(^|\.)bilibili\.com$/i, path: /^\/video\/av[0-9]+/i, note: '老 av 号视频' },
    { id: 'bilibili', form: 'bangumi', host: /(^|\.)bilibili\.com$/i, path: /^\/bangumi\/play\/(ep|ss)[0-9]+/i, note: '番剧 / 影视播放页' },
    { id: 'bilibili', form: 'cheese', host: /(^|\.)bilibili\.com$/i, path: /^\/cheese\/play\/(ep|ss)[0-9]+/i, note: '课堂播放页' },
    { id: 'bilibili', form: 'list', host: /(^|\.)bilibili\.com$/i, path: /^\/(list|medialist)\/(watchlater|fav|series|[A-Za-z0-9_-]+)/i, note: '稍后再看 / 收藏夹 / 合集播放页' },
    // 嵌入播放器：博客、文档、课件里 iframe 嵌的 B 站播放器。油猴会在 iframe 内执行脚本，
    // 以前这条不认，导致「网页里嵌的 B 站视频完全用不了」。
    { id: 'bilibili', form: 'embed', host: /(^|\.)player\.bilibili\.com$/i, path: /^\/player\.html/i, note: '嵌入播放器（iframe）' },
    // —— YouTube ——
    { id: 'youtube', form: 'watch', host: /(^|\.)youtube\.com$/i, path: /^\/watch$/i, note: '观看页（?v=）' },
    { id: 'youtube', form: 'embed', host: /(^|\.)youtube\.com$/i, path: /^\/embed\//i, note: '嵌入播放器' },
    { id: 'youtube', form: 'shorts', host: /(^|\.)youtube\.com$/i, path: /^\/shorts\//i, note: 'Shorts' },
    { id: 'youtube', form: 'live', host: /(^|\.)youtube\.com$/i, path: /^\/live\//i, note: '直播' },
    { id: 'youtube', form: 'watch', host: /^youtu\.be$/i, path: /^\//, note: '短链' },
    { id: 'youtube', form: 'watch', host: /(^|\.)youtube-nocookie\.com$/i, path: /^\/embed\//i, note: '隐私增强嵌入' }
  ];

  function safeUrl(href) {
    try { return new URL(String(href || '')); } catch (e) { return null; }
  }
  function hostOf(u) { return String(u.hostname || '').replace(/^www\./i, '').replace(/^m\./i, ''); }

  /**
   * 认领一条 URL。返回 { id, form, note }，不认领返回 null。
   */
  function detect(href) {
    var u = safeUrl(href);
    if (!u) return null;
    var host = hostOf(u);
    var path = u.pathname || '/';
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (!r.host.test(host)) continue;
      if (!r.path.test(path)) continue;
      // youtu.be 短链：路径必须带 11 位 ID，裸域名不算
      if (r.form === 'watch' && /^youtu\.be$/i.test(host) && !/^\/[A-Za-z0-9_-]{11}/.test(path)) continue;
      // youtube.com/watch 必须有 v 参数（光有 /watch 没有视频 ID 不算）
      if (r.id === 'youtube' && r.form === 'watch' && /youtube\.com$/i.test(host) && !u.searchParams.get('v')) continue;
      return { id: r.id, form: r.form, note: r.note };
    }
    return null;
  }

  function siteOf(href) { var d = detect(href); return d ? d.id : null; }
  function formOf(href) { var d = detect(href); return d ? d.form : null; }
  function isCovered(href) { return !!detect(href); }

  /**
   * 从 URL 抽视频参数。B 站的嵌入播放器 / 稍后再看 / 收藏夹这些形态，
   * 视频号只出现在查询串里（?bvid=BVxxx&cid=123），pathname 里根本没有，
   * 以前只从 pathname 找 BV，这些页面一律解析为空。
   */
  function videoParams(href) {
    var out = { bvid: '', aid: '', cid: '', page: 1 };
    var u = safeUrl(href);
    if (!u) return out;
    var p = u.searchParams;
    var path = u.pathname || '';

    var bvid = String(p.get('bvid') || p.get('bv') || '').trim();
    if (!/^BV[0-9A-Za-z]+$/i.test(bvid)) bvid = '';
    if (!bvid) {
      var m = path.match(/\/video\/(BV[0-9A-Za-z]+)/i);
      if (m) bvid = m[1];
    }
    out.bvid = bvid;

    var aid = String(p.get('aid') || '').trim();
    if (!/^\d+$/.test(aid)) aid = '';
    if (!aid) {
      var ma = path.match(/\/video\/av(\d+)/i);
      if (ma) aid = ma[1];
    }
    out.aid = aid;

    var cid = String(p.get('cid') || '').trim();
    out.cid = /^\d+$/.test(cid) ? cid : '';

    var page = parseInt(p.get('p') || p.get('page') || '1', 10);
    out.page = isFinite(page) && page >= 1 ? page : 1;
    return out;
  }

  // 该页面是否值得显示入口按钮（认领的站点；通用站点交给 html5 的 <video> 探测）
  function showEntryOn(href) {
    var d = detect(href);
    if (d) return true;
    var u = safeUrl(href);
    if (!u) return false;
    return false;   // 通用站点由调用方再判 document.querySelector('video')
  }

  return {
    RULES: RULES,
    detect: detect,
    siteOf: siteOf,
    formOf: formOf,
    isCovered: isCovered,
    videoParams: videoParams,
    showEntryOn: showEntryOn
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createSiteMatchModule();
// </node-only>
