'use strict';

function createSearchFilterModule() {
  function clampInt(n, min, max, fallback) {
    n = parseInt(n, 10);
    return isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }

  function encodeParams(obj) {
    return Object.keys(obj).filter(function (key) {
      return obj[key] !== undefined && obj[key] !== null && obj[key] !== '';
    }).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]);
    }).join('&');
  }

  function decodeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .trim();
  }

  function parseCount(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    var text = String(value == null ? '' : value).replace(/,/g, '').trim();
    var n = parseFloat(text) || 0;
    if (/亿/.test(text)) n *= 100000000;
    else if (/万/.test(text)) n *= 10000;
    return Math.round(n);
  }

  function parseBiliDuration(value) {
    if (typeof value === 'number') return Math.max(0, value);
    var parts = String(value || '').split(':').map(Number);
    if (!parts.length || parts.some(function (n) { return !isFinite(n); })) return 0;
    var sec = 0;
    for (var i = 0; i < parts.length; i++) sec = sec * 60 + parts[i];
    return sec;
  }

  function parseIsoDuration(value) {
    var m = String(value || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
    if (!m) return 0;
    return Math.round((Number(m[1]) || 0) * 86400 + (Number(m[2]) || 0) * 3600 + (Number(m[3]) || 0) * 60 + (Number(m[4]) || 0));
  }

  function toIsoDate(value) {
    if (!value) return '';
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      var n = Number(value);
      if (n < 100000000000) n *= 1000;
      var d = new Date(n);
      return isNaN(d.getTime()) ? '' : d.toISOString();
    }
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  function coerceSubtitleFlag(value) {
    if (value == null || value === '') return null;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return !!value;
  }

  function normalizeBilibili(item) {
    item = item || {};
    return {
      id: item.bvid || String(item.aid || item.id || ''),
      platform: 'bilibili',
      bvid: item.bvid || '',
      aid: item.aid || item.id || '',
      cid: item.cid || null,
      videoId: '',
      title: decodeHtml(item.title),
      author: decodeHtml(item.author || (item.owner && item.owner.name) || ''),
      durationSec: parseBiliDuration(item.duration),
      pubdate: toIsoDate(item.pubdate || item.created),
      play: parseCount(item.play || (item.stat && item.stat.view)),
      danmaku: parseCount(item.video_review || item.danmaku || (item.stat && item.stat.danmaku)),
      like: parseCount(item.like || (item.stat && item.stat.like)),
      coin: parseCount(item.coin || (item.stat && item.stat.coin)),
      favorite: parseCount(item.favorites || item.favorite || (item.stat && item.stat.favorite)),
      url: item.arcurl || (item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : ''),
      tid: item.typeid || item.tid || '',
      typename: decodeHtml(item.typename || item.tname || ''),
      desc: decodeHtml(item.description || item.desc || ''),
      tags: decodeHtml(item.tag || ''),
      mid: item.mid || (item.owner && item.owner.mid) || '',
      // 为什么：布尔字段可能以字符串 'false' 形式从缓存/旧配置流入，!!'false' 会得到
      // true，把「确定无字幕」误判成「有字幕」，评分引擎就不再重罚 ASR 成本。
      hasNativeSubtitle: coerceSubtitleFlag(item.hasNativeSubtitle),
      subtitleProbeError: ''
    };
  }

  function normalizeYouTube(searchItem, detail) {
    searchItem = searchItem || {};
    detail = detail || {};
    var snippet = detail.snippet || searchItem.snippet || {};
    var stats = detail.statistics || {};
    var id = detail.id || (searchItem.id && searchItem.id.videoId) || '';
    return {
      id: id,
      platform: 'youtube',
      bvid: '',
      aid: '',
      cid: null,
      videoId: id,
      title: decodeHtml(snippet.title || ''),
      author: decodeHtml(snippet.channelTitle || ''),
      durationSec: parseIsoDuration(detail.contentDetails && detail.contentDetails.duration),
      pubdate: toIsoDate(snippet.publishedAt),
      play: parseCount(stats.viewCount),
      danmaku: 0,
      like: parseCount(stats.likeCount),
      coin: 0,
      favorite: parseCount(stats.favoriteCount),
      url: id ? 'https://www.youtube.com/watch?v=' + id : '',
      tid: snippet.categoryId || '',
      typename: '',
      desc: decodeHtml(snippet.description || ''),
      tags: Array.isArray(snippet.tags) ? snippet.tags.join(',') : '',
      channelId: snippet.channelId || '',
      hasNativeSubtitle: !!(detail.contentDetails && detail.contentDetails.caption === 'true'),
      subtitleProbeError: ''
    };
  }

  function randomDelayMs(random) {
    var r = typeof random === 'function' ? random() : Math.random();
    // 为什么：测试或调用方注入的 random 可能返回 NaN / 字符串，不设防会让延迟变成
    // NaN，sleep(NaN) 立即返回，节流形同虚设，反而更容易触发 412 风控。
    if (!isFinite(r)) r = 0.5;
    return 800 + Math.floor(Math.max(0, Math.min(0.999999, r)) * 701);
  }

  async function searchBilibili(keyword, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    if (!keyword || !String(keyword).trim()) throw new Error('请输入搜索关键词');
    if (typeof deps.gx !== 'function' || typeof deps.getWbiKeys !== 'function' || typeof deps.wbiQuery !== 'function') throw new Error('B站搜索依赖未注入');

    var order = ['totalrank', 'click', 'pubdate', 'dm', 'stow'].indexOf(opts.order) >= 0 ? opts.order : 'totalrank';
    var params = {
      search_type: 'video',
      keyword: String(keyword).trim(),
      order: order,
      duration: [0, 1, 2, 3, 4].indexOf(Number(opts.duration)) >= 0 ? Number(opts.duration) : 0,
      tids: opts.tids || 0,
      page: clampInt(opts.page, 1, 50, 1),
      page_size: clampInt(opts.maxResults, 1, 50, 20)
    };

    async function requestSearch(force) {
      await deps.getWbiKeys(!!force);
      var raw = await deps.gx('https://api.bilibili.com/x/web-interface/search/type?' + deps.wbiQuery(params), {
        timeout: 15000,
        retries: 2,
        referer: 'https://www.bilibili.com/'
      });
      return JSON.parse(raw);
    }

    var response = await requestSearch(false);
    if (response.code === -403) response = await requestSearch(true);
    if (response.code !== 0) throw new Error('B站搜索失败 code=' + response.code + (response.message ? '：' + response.message : ''));

    var source = (response.data && response.data.result) || [];
    var items = source.slice(0, params.page_size).map(normalizeBilibili);
    if (opts.inspectSubtitles === false) return items;

    // 判字幕必须逐条请求 player/v2；800–1500ms 的候选级节流是为了降低 412 风控概率。
    for (var i = 0; i < items.length; i++) {
      if (i > 0 && typeof deps.sleep === 'function') await deps.sleep(randomDelayMs(deps.random));
      var candidate = items[i];
      try {
        var viewRaw = await deps.gx('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(candidate.bvid), {
          timeout: 10000,
          retries: 1,
          referer: 'https://www.bilibili.com/'
        });
        var view = JSON.parse(viewRaw);
        if (view.code === 0 && view.data) {
          var v = view.data;
          candidate.aid = v.aid || candidate.aid;
          candidate.cid = v.cid || (v.pages && v.pages[0] && v.pages[0].cid) || candidate.cid;
          candidate.author = (v.owner && v.owner.name) || candidate.author;
          candidate.durationSec = Number(v.duration) || candidate.durationSec;
          candidate.pubdate = toIsoDate(v.pubdate) || candidate.pubdate;
          candidate.play = parseCount(v.stat && v.stat.view) || candidate.play;
          candidate.danmaku = parseCount(v.stat && v.stat.danmaku) || candidate.danmaku;
          // 为什么：like/coin/favorite 原先漏写了 `|| candidate.like` 兜底——view 接口
          // 偶尔不返回 stat 或字段为 0 时，会把搜索结果里已有的有效值清零，评分时
          // 收藏比直接失真。与上下相邻字段保持一致的兜底语义。
          candidate.like = parseCount(v.stat && v.stat.like) || candidate.like;
          candidate.coin = parseCount(v.stat && v.stat.coin) || candidate.coin;
          candidate.favorite = parseCount(v.stat && v.stat.favorite) || candidate.favorite;
          candidate.tid = v.tid || candidate.tid;
          candidate.typename = v.tname || candidate.typename;
          candidate.desc = v.desc || candidate.desc;
        }
        if (!candidate.cid) throw new Error('无法取得 cid');
        var playerRaw = await deps.gx('https://api.bilibili.com/x/player/v2?bvid=' + encodeURIComponent(candidate.bvid) + '&cid=' + encodeURIComponent(candidate.cid), {
          timeout: 10000,
          retries: 0,
          referer: 'https://www.bilibili.com/'
        });
        var player = JSON.parse(playerRaw);
        if (player.code !== 0) throw new Error('player/v2 code=' + player.code);
        var subtitles = player.data && player.data.subtitle && player.data.subtitle.subtitles;
        candidate.hasNativeSubtitle = !!(subtitles && subtitles.length);
      } catch (error) {
        candidate.hasNativeSubtitle = null;
        candidate.subtitleProbeError = String(error && error.message || error);
      }
      if (typeof opts.onProbe === 'function') opts.onProbe(i + 1, items.length, candidate);
    }
    return items;
  }

  async function searchYouTube(keyword, opts, deps) {
    opts = opts || {};
    deps = deps || {};
    if (!keyword || !String(keyword).trim()) throw new Error('请输入搜索关键词');
    if (!opts.apiKey) throw new Error('请先在设置中填写 YouTube Data API Key');
    if (typeof deps.gx !== 'function') throw new Error('YouTube 搜索依赖未注入');

    var maxResults = clampInt(opts.maxResults, 1, 50, 20);
    var searchParams = {
      part: 'snippet',
      type: 'video',
      q: String(keyword).trim(),
      maxResults: maxResults,
      key: opts.apiKey,
      order: opts.order || 'relevance',
      videoCaption: opts.nativeOnly ? 'closedCaption' : (opts.videoCaption || 'any'),
      videoDuration: opts.videoDuration || undefined,
      videoDefinition: opts.videoDefinition || undefined,
      videoCategoryId: opts.videoCategoryId || undefined,
      channelId: opts.channelId || undefined,
      publishedAfter: opts.publishedAfter || undefined,
      publishedBefore: opts.publishedBefore || undefined,
      relevanceLanguage: opts.relevanceLanguage || undefined
    };
    var raw = await deps.gx('https://www.googleapis.com/youtube/v3/search?' + encodeParams(searchParams), { timeout: 20000, retries: 2 });
    var searchData = JSON.parse(raw);
    if (searchData.error) throw new Error('YouTube 搜索失败：' + (searchData.error.message || searchData.error.code));
    var searchItems = searchData.items || [];
    var ids = searchItems.map(function (item) { return item.id && item.id.videoId; }).filter(Boolean);
    if (!ids.length) return [];

    var detailRaw = await deps.gx('https://www.googleapis.com/youtube/v3/videos?' + encodeParams({
      part: 'snippet,contentDetails,statistics',
      id: ids.join(','),
      key: opts.apiKey
    }), { timeout: 20000, retries: 2 });
    var detailData = JSON.parse(detailRaw);
    if (detailData.error) throw new Error('YouTube 视频详情失败：' + (detailData.error.message || detailData.error.code));
    var details = {};
    (detailData.items || []).forEach(function (item) { details[item.id] = item; });
    return searchItems.map(function (item) {
      var id = item.id && item.id.videoId;
      return normalizeYouTube(item, details[id]);
    }).filter(function (item) { return !!item.videoId; });
  }

  function filterCandidates(items, opts) {
    opts = opts || {};
    var minDuration = Math.max(0, Number(opts.minDurationSec) || 0);
    var maxDuration = Math.max(0, Number(opts.maxDurationSec) || 0);
    var minPlay = Math.max(0, Number(opts.minPlay) || 0);
    var minScore = Number(opts.minScore);
    var after = opts.publishedAfter ? new Date(opts.publishedAfter).getTime() : 0;
    return (items || []).filter(function (item) {
      var duration = Number(item.durationSec) || 0;
      if (minDuration && duration < minDuration) return false;
      if (maxDuration && duration > maxDuration) return false;
      if ((Number(item.play) || 0) < minPlay) return false;
      if (opts.nativeOnly && item.hasNativeSubtitle !== true) return false;
      if (isFinite(minScore) && item.score && item.score.total < minScore) return false;
      if (after && (!item.pubdate || new Date(item.pubdate).getTime() < after)) return false;
      return true;
    });
  }

  function extractJsonObject(text, start) {
    var begin = text.indexOf('{', start);
    if (begin < 0) return null;
    var depth = 0, quote = false, escaped = false;
    for (var i = begin; i < text.length; i++) {
      var ch = text[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quote = false;
        continue;
      }
      if (ch === '"') quote = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return text.slice(begin, i + 1);
    }
    return null;
  }

  function extractYouTubeCaptionTracks(html) {
    var text = String(html || '');
    var marker = text.indexOf('ytInitialPlayerResponse');
    while (marker >= 0) {
      var jsonText = extractJsonObject(text, marker);
      if (jsonText) {
        try {
          var data = JSON.parse(jsonText);
          var list = data.captions && data.captions.playerCaptionsTracklistRenderer && data.captions.playerCaptionsTracklistRenderer.captionTracks;
          if (list && list.length) return list;
        } catch (error) {}
      }
      marker = text.indexOf('ytInitialPlayerResponse', marker + 24);
    }
    return [];
  }

  async function fetchYouTubeSubtitle(candidate, deps) {
    deps = deps || {};
    if (!candidate || !candidate.videoId) throw new Error('缺少 YouTube videoId');
    if (typeof deps.gx !== 'function' || typeof deps.parseTtml !== 'function') throw new Error('YouTube 字幕依赖未注入');
    var html = await deps.gx('https://www.youtube.com/watch?v=' + encodeURIComponent(candidate.videoId), {
      timeout: 30000,
      retries: 1,
      referer: 'https://www.youtube.com/'
    });
    var tracks = extractYouTubeCaptionTracks(html);
    if (!tracks.length) throw new Error('视频页未暴露可下载字幕轨道');
    tracks.sort(function (a, b) {
      function rank(t) {
        var lan = String(t.languageCode || '').toLowerCase();
        var langRank = /^zh/.test(lan) ? 0 : (/^en/.test(lan) ? 1 : 2);
        return langRank + (t.kind === 'asr' ? 10 : 0);
      }
      return rank(a) - rank(b);
    });
    var url = tracks[0].baseUrl;
    if (!url) throw new Error('字幕轨道缺少下载地址');
    var ttml = await deps.gx(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'fmt=ttml', {
      timeout: 30000,
      retries: 1,
      referer: 'https://www.youtube.com/'
    });
    var body = deps.parseTtml(ttml);
    if (!body || !body.length) throw new Error('YouTube 字幕内容为空');
    return body;
  }

  return {
    parseCount: parseCount,
    parseBiliDuration: parseBiliDuration,
    parseIsoDuration: parseIsoDuration,
    randomDelayMs: randomDelayMs,
    normalizeBilibili: normalizeBilibili,
    normalizeYouTube: normalizeYouTube,
    searchBilibili: searchBilibili,
    searchYouTube: searchYouTube,
    filterCandidates: filterCandidates,
    extractYouTubeCaptionTracks: extractYouTubeCaptionTracks,
    fetchYouTubeSubtitle: fetchYouTubeSubtitle
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createSearchFilterModule();
// </node-only>
