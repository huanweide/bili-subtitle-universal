'use strict';

function createCandidateScorerModule() {
  // 三套权重预设 = 三种「选片策略」，一键切换（v9.5）。
  // 设计依据不是好看，是这 11 个权重的真实含义：它们在权衡两端——
  // 一端是「省 ASR 成本」（nativeSubtitle / noNativeSubtitle），
  // 另一端是「知识干货密度」（knowledgeCategory / knowledgeKeyword /
  // favoriteLikeRatio / coinLikeRatio）。预设就沿这条轴设计：
  //   costFirst（保守）：宁缺毋滥，无字幕基本否决，绝不为省事之外的理由烧 ASR；
  //   balanced（均衡）  ：成本与干货大致对冲，是默认档；
  //   qualityFirst（激进）：内容为王，没字幕但极干货的照样跑 ASR。
  // 新增预设时键集合必须与 DEFAULT_WEIGHTS 一致，test-scorer 有断言钉死。
  var WEIGHT_PRESETS = {
    costFirst: {
      nativeSubtitle: 70,
      noNativeSubtitle: -70,
      subtitleUnknown: -30,
      durationIdeal: 12,
      durationTooShort: -18,
      durationTooLong: -25,
      knowledgeCategory: 10,
      knowledgeKeyword: 12,
      favoriteLikeRatio: 6,
      coinLikeRatio: 4,
      excludeKeyword: -36
    },
    balanced: {
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
    },
    qualityFirst: {
      nativeSubtitle: 14,
      noNativeSubtitle: -6,
      subtitleUnknown: -4,
      durationIdeal: 22,
      durationTooShort: -22,
      durationTooLong: -16,
      knowledgeCategory: 26,
      knowledgeKeyword: 30,
      favoriteLikeRatio: 24,
      coinLikeRatio: 18,
      excludeKeyword: -46
    }
  };

  var DEFAULT_PRESET = 'balanced';

  // 均衡档就是默认权重——单一事实源，两处各写一份迟早会漂。
  var DEFAULT_WEIGHTS = WEIGHT_PRESETS[DEFAULT_PRESET];

  var WEIGHT_PRESET_LABELS = {
    costFirst: '保守（省 ASR）',
    balanced: '均衡',
    qualityFirst: '激进（要干货）'
  };

  // 滑块面板的中文标签与取值范围。新增权重键时这里必须同步加一项：
  // 滑块面板按这两个表渲染，漏加标签 = 该项在面板里静默消失（非技术用户根本
  // 不知道能调它）。test-scorer 有断言钉死「标签键集合 === 默认权重键集合」。
  var WEIGHT_LABELS = {
    nativeSubtitle: '有原生字幕（免 ASR）',
    noNativeSubtitle: '无原生字幕（要 ASR）',
    subtitleUnknown: '字幕状态未知',
    durationIdeal: '时长 8–60 分钟',
    durationTooShort: '时长不足 3 分钟',
    durationTooLong: '时长超过 2 小时',
    knowledgeCategory: '知识类分区',
    knowledgeKeyword: '标题含知识词',
    favoriteLikeRatio: '收藏/点赞比',
    coinLikeRatio: '投币/点赞比',
    excludeKeyword: '标题含排除词'
  };
  // 与 normalizeWeights 的 clamp(-100, 100) 保持一致：滑块到头就是截断边界，
  // 不会出现「拖到 150 被静默截回 100」的货不对板。
  var WEIGHT_RANGE = { min: -100, max: 100 };

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

  function getPreset(name) {
    // 未知预设名回退默认档：预设名来自 UI 的 data 属性，万一将来加了按钮忘了
    // 同步导出，用户点到也不该炸——降级而不是崩。
    return normalizeWeights(WEIGHT_PRESETS[name] || WEIGHT_PRESETS[DEFAULT_PRESET]);
  }

  function matchPreset(weights) {
    // 当前权重恰好等于某套预设就返回预设名，否则 null（面板显示「自定义」）。
    // 为什么要有这个判定：用户拖一下滑块就脱离预设了，面板却还高亮着「均衡」，
    // 那是在骗人。null 才是诚实的答案。
    var w = normalizeWeights(weights);
    var names = Object.keys(WEIGHT_PRESETS);
    for (var i = 0; i < names.length; i++) {
      var p = WEIGHT_PRESETS[names[i]];
      var same = Object.keys(p).every(function (key) { return p[key] === w[key]; });
      if (same) return names[i];
    }
    return null;
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
    WEIGHT_LABELS: Object.assign({}, WEIGHT_LABELS),
    WEIGHT_RANGE: { min: WEIGHT_RANGE.min, max: WEIGHT_RANGE.max },
    WEIGHT_PRESETS: JSON.parse(JSON.stringify(WEIGHT_PRESETS)),
    WEIGHT_PRESET_LABELS: Object.assign({}, WEIGHT_PRESET_LABELS),
    DEFAULT_PRESET: DEFAULT_PRESET,
    getPreset: getPreset,
    matchPreset: matchPreset,
    normalizeWeights: normalizeWeights,
    scoreCandidate: scoreCandidate
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createCandidateScorerModule();
// </node-only>
