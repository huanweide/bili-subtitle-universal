'use strict';

function createCandidateScorerModule() {
  // 默认权重必须集中、可序列化，设置面板才能让用户透明地调整，而不是散落在判断分支里。
  var DEFAULT_WEIGHTS = {
    nativeSubtitle: 42,
    noNativeSubtitle: -38,
    subtitleUnknown: -8,
    durationIdeal: 14,
    durationTooShort: -18,
    durationTooLong: -20,
    knowledgeCategory: 16,
    knowledgeKeyword: 18,
    favoriteLikeRatio: 14,
    coinLikeRatio: 10,
    excludeKeyword: -36
  };

  var KNOWLEDGE_CATEGORY_RE = /(知识|科技|科普|校园|学习|教育|职场|计算机|编程|数码|财经|商业|公开课|讲座)/i;
  var KNOWLEDGE_TITLE_RE = /(教程|讲解|保姆级|从零|入门|原理|拆解|复盘|一文讲透|how\s+to|explained|deep\s+dive|crash\s+course)/i;
  var EXCLUDE_TITLE_RE = /(直播回放|reaction|挑战|翻唱|整活)/i;

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function normalizeWeights(custom) {
    var out = {};
    Object.keys(DEFAULT_WEIGHTS).forEach(function (key) {
      // 为什么：设置面板清空某项时存进来的是 null / 空串，而 Number(null)===0 会通过
      // isFinite 检查，把「用户没配」误判成「配了 0 分」，信号被静默关掉。这里显式把
      // null / undefined / '' 当未配置，回退默认值。
      var raw = custom ? custom[key] : undefined;
      var n = (raw == null || raw === '') ? NaN : Number(raw);
      out[key] = isFinite(n) ? clamp(n, -100, 100) : DEFAULT_WEIGHTS[key];
    });
    return out;
  }

  function addReason(reasons, signal, weight, detail) {
    if (!weight) return;
    reasons.push({ signal: signal, weight: weight, detail: detail });
  }

  function ratioScore(value, fullAt, weight) {
    if (!(value > 0)) return 0;
    if (value >= fullAt) return weight;
    if (value >= fullAt * 0.4) return Math.round(weight * 0.5);
    return 0;
  }

  function scoreCandidate(item, customWeights) {
    item = item || {};
    var w = normalizeWeights(customWeights);
    var reasons = [];
    var total = 0;
    var hasSubtitle = item.hasNativeSubtitle;

    if (hasSubtitle === true || hasSubtitle === 'true') {
      total += w.nativeSubtitle;
      addReason(reasons, 'nativeSubtitle', w.nativeSubtitle, '检测到原生字幕，可避免昂贵 ASR');
    } else if (hasSubtitle === false || hasSubtitle === 'false') {
      total += w.noNativeSubtitle;
      addReason(reasons, 'noNativeSubtitle', w.noNativeSubtitle, '未检测到原生字幕，需要 ASR');
    } else {
      total += w.subtitleUnknown;
      addReason(reasons, 'subtitleUnknown', w.subtitleUnknown, '字幕状态未知，可能受登录态或风控影响');
    }

    var duration = Number(item.durationSec) || 0;
    if (duration >= 8 * 60 && duration <= 60 * 60) {
      total += w.durationIdeal;
      addReason(reasons, 'durationIdeal', w.durationIdeal, '时长位于 8–60 分钟的知识内容高密度区间');
    } else if (duration > 0 && duration < 3 * 60) {
      total += w.durationTooShort;
      addReason(reasons, 'durationTooShort', w.durationTooShort, '时长不足 3 分钟');
    } else if (duration > 2 * 60 * 60) {
      total += w.durationTooLong;
      addReason(reasons, 'durationTooLong', w.durationTooLong, '时长超过 2 小时，处理成本高');
    }

    var category = String(item.typename || item.categoryTitle || item.category || '');
    if (KNOWLEDGE_CATEGORY_RE.test(category)) {
      total += w.knowledgeCategory;
      addReason(reasons, 'knowledgeCategory', w.knowledgeCategory, '分区“' + category + '”属于知识/科技/学习/职场范围');
    }

    var title = String(item.title || '');
    var knowledgeHit = title.match(KNOWLEDGE_TITLE_RE);
    if (knowledgeHit) {
      total += w.knowledgeKeyword;
      addReason(reasons, 'knowledgeKeyword', w.knowledgeKeyword, '标题命中知识词“' + knowledgeHit[0] + '”');
    }

    var likes = Math.max(0, Number(item.like) || 0);
    var favorites = Math.max(0, Number(item.favorite) || 0);
    var coins = Math.max(0, Number(item.coin) || 0);
    if (likes > 0) {
      var favoriteRatio = favorites / likes;
      var favoriteWeight = ratioScore(favoriteRatio, 0.35, w.favoriteLikeRatio);
      total += favoriteWeight;
      addReason(reasons, 'favoriteLikeRatio', favoriteWeight, '收藏/点赞=' + favoriteRatio.toFixed(2) + '，收藏意愿体现干货密度');

      var coinRatio = coins / likes;
      var coinWeight = ratioScore(coinRatio, 0.2, w.coinLikeRatio);
      total += coinWeight;
      addReason(reasons, 'coinLikeRatio', coinWeight, '投币/点赞=' + coinRatio.toFixed(2) + '，付费式认可较强');
    }

    var excludeHit = title.match(EXCLUDE_TITLE_RE);
    if (excludeHit) {
      total += w.excludeKeyword;
      addReason(reasons, 'excludeKeyword', w.excludeKeyword, '标题命中排除词“' + excludeHit[0] + '”');
    }

    total = clamp(Math.round(total), -100, 100);
    return { total: total, reasons: reasons, tier: total >= 55 ? 'A' : (total >= 25 ? 'B' : 'C') };
  }

  return {
    DEFAULT_WEIGHTS: Object.assign({}, DEFAULT_WEIGHTS),
    normalizeWeights: normalizeWeights,
    scoreCandidate: scoreCandidate
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createCandidateScorerModule();
// </node-only>
