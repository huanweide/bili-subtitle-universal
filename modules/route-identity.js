'use strict';

/**
 * 路由身份识别（v9.6）。
 *
 * 背景：脚本用「location.href 变了没」判断用户是不是换了一条视频。B 站的评论区时间戳、
 * 章节锚点、分享链接都会往 URL 上挂 ?t=123 / &spm_id_from=xxx / &vd_source=xxx 这类参数，
 * 于是「点了个锚点跳到第 2 分钟」被误判成「换了一条视频」——取好的字幕被整条清空，
 * 用户还得再点一次「⚡ 获取字幕」。这是纯误伤：视频根本没变。
 *
 * 正解：比较「视频身份」而不是比较整条 URL。身份 = 站点 + 视频号 + 分 P 号，
 * 锚点与追踪参数一律不参与比较。
 *
 * 设计约束：
 * 1. 纯函数，不碰 DOM、不碰 location——Node 里能完整测试。
 * 2. 解析失败绝不抛异常，退化成去锚点后的原始串（宁可多 reset 一次，不能崩）。
 * 3. 追踪参数表是「宁可多列」的：漏列一个 = 一次误伤，多列一个 = 只影响通用站点的
 *    身份粒度（通用站没有视频号，只能靠 URL 本身）。
 * 4. 分 P 号必须参与身份：B 站 ?p=2 是另一条 cid，字幕必须重取。
 */
function createRouteIdentityModule() {
  // 锚点与追踪参数：变了不算换视频。
  // t = B 站/YouTube 的跳转秒数（章节锚点、评论区时间戳链接就是它）；
  // 其余是各站的增长/分享归因参数，每点一次链接都可能变。
  var TRACKING_PARAMS = [
    't', 'start', 'end', 'time_continue', 'timestamp', 'ts', '_',
    'spm_id_from', 'from_spmid', 'spm', 'vd_source', 'from', 'seid', 'tracelog',
    'share_source', 'share_medium', 'share_plat', 'share_session_id', 'share_tag', 'share_times',
    'unique_k', 'buvid', 'buvid3', 'buvid4', 'up_id', 'visit_id', 'session_id',
    'callback', 'plat_id', 'goto', 'report_source', 'o', 'wxf', 'wm', 'ci', 'dm', 'at',
    'abtest', 'vt', 'live_from', 'referfrom', 'trackid', 'msource', 'spmid', 'utm_source',
    'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'
  ];
  var TRACK = {};
  for (var i = 0; i < TRACKING_PARAMS.length; i++) TRACK[TRACKING_PARAMS[i]] = true;

  // 这些参数看着像参数，其实是「内容的一部分」，不能丢
  var KEEP_PARAMS = { p: true, page: true, v: true, list: true, index: true };

  function safeUrl(href) {
    try { return new URL(String(href || '')); } catch (e) { return null; }
  }

  function keptQuery(u) {
    var out = [];
    u.searchParams.forEach(function (v, k) {
      var lk = String(k).toLowerCase();
      if (KEEP_PARAMS[lk]) { out.push(lk + '=' + v); return; }
      if (TRACK[lk]) return;
      out.push(lk + '=' + v);
    });
    out.sort();
    return out.join('&');
  }

  function pageNumber(u) {
    var p = parseInt(u.searchParams.get('p'), 10);
    if (!isFinite(p) || p < 1) p = 1;
    return p;
  }

  // B 站：/video/BVxxx?p=N 是最常见形态；番剧走 ep/ss；合集/稍后再看走 list。
  function biliIdentity(u) {
    var host = String(u.hostname || '').replace(/^www\./i, '').replace(/^m\./i, '');
    if (!/(^|\.)bilibili\.com$/i.test(host)) return null;
    var path = u.pathname || '';
    var mv = path.match(/\/video\/(BV[0-9A-Za-z]+)/i);
    if (mv) return { id: 'bili:' + mv[1] + ':p' + pageNumber(u), family: 'bili:' + mv[1], page: pageNumber(u), site: 'bilibili' };
    var ma = path.match(/\/video\/(av[0-9]+)/i);
    if (ma) return { id: 'bili:' + ma[1] + ':p' + pageNumber(u), family: 'bili:' + ma[1], page: pageNumber(u), site: 'bilibili' };
    var me = path.match(/\/bangumi\/play\/(ep[0-9]+)/i);
    if (me) return { id: 'bili:' + me[1], family: 'bili:' + me[1], page: 1, site: 'bilibili' };
    var ms = path.match(/\/bangumi\/play\/(ss[0-9]+)/i);
    if (ms) return { id: 'bili:' + ms[1], family: 'bili:' + ms[1], page: 1, site: 'bilibili' };
    var ml = path.match(/\/(?:list|medialist)\/(?:watchlater|fav|series|[A-Za-z0-9_-]+)/i);
    if (ml) return { id: 'bili:list:' + ml[0], family: 'bili:list:' + ml[0], page: 1, site: 'bilibili' };
    return null;
  }

  function ytIdentity(u) {
    var host = String(u.hostname || '').replace(/^www\./i, '').replace(/^m\./i, '');
    var isYt = /(^|\.)youtube\.com$/i.test(host) || host === 'youtu.be' || /(^|\.)youtube-nocookie\.com$/i.test(host);
    if (!isYt) return null;
    if (host === 'youtu.be') {
      var s = String(u.pathname || '').replace(/^\//, '').split('/')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { id: 'yt:' + s, family: 'yt:' + s, page: 1, site: 'youtube' };
      return null;
    }
    var v = u.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { id: 'yt:' + v, family: 'yt:' + v, page: 1, site: 'youtube' };
    var m = String(u.pathname || '').match(/\/(?:watch|embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return { id: 'yt:' + m[1], family: 'yt:' + m[1], page: 1, site: 'youtube' };
    return null;
  }

  // 解析不了 URL（相对路径 / 怪协议）时的退化：至少把锚点和 hash 剥掉
  function fallbackIdentity(href) {
    var s = String(href || '').split('#')[0];
    s = s.replace(/([?&])t=\d+(?=&|$)/g, '$1').replace(/[?&]$/, '');
    return { id: 'raw:' + s, family: 'raw:' + s, page: 1, site: 'generic' };
  }

  /**
   * 解析一条 URL 的视频身份。
   * 返回 { id, family, page, site }：
   *  - id：完整身份（含分 P），变了这个 = 必须重取字幕
   *  - family：去掉分 P 的身份，用来区分「换 P」和「换视频」
   *  - page：分 P 号（B 站有效，其余恒为 1）
   *  - site：站点归类
   */
  function parse(href) {
    var u = safeUrl(href);
    if (!u) return fallbackIdentity(href);
    var r = biliIdentity(u) || ytIdentity(u);
    if (r) return r;
    var q = keptQuery(u);
    var base = String(u.origin || '') + String(u.pathname || '') + (q ? '?' + q : '');
    return { id: 'page:' + base, family: 'page:' + base, page: 1, site: 'generic' };
  }

  function identity(href) { return parse(href).id; }
  function family(href) { return parse(href).family; }

  // 身份相同 = 同一条视频（锚点/追踪参数变化不算）
  function isSameVideo(a, b) {
    if (!a || !b) return false;
    return identity(a) === identity(b);
  }

  // 同一条视频换了分 P：字幕必须重取，但不用当成「换了一条视频」
  function isSameVideoFamily(a, b) {
    if (!a || !b) return false;
    var fa = parse(a), fb = parse(b);
    return !!fa.family && fa.family === fb.family && fa.id !== fb.id;
  }

  function pageOf(href) { return parse(href).page; }
  function siteOf(href) { return parse(href).site; }

  // 把 URL 洗成「去掉锚点与追踪参数」的干净形态：用于显示与日志，不用于比较
  function cleanUrl(href) {
    var u = safeUrl(href);
    if (!u) return fallbackIdentity(href).id.replace(/^raw:/, '');
    var q = keptQuery(u);
    return String(u.origin || '') + String(u.pathname || '') + (q ? '?' + q : '');
  }

  return {
    TRACKING_PARAMS: TRACKING_PARAMS,
    parse: parse,
    identity: identity,
    family: family,
    isSameVideo: isSameVideo,
    isSameVideoFamily: isSameVideoFamily,
    pageOf: pageOf,
    siteOf: siteOf,
    cleanUrl: cleanUrl
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createRouteIdentityModule();
// </node-only>
