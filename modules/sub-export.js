'use strict';

/**
 * 字幕检索与更多导出格式（v9.9）。
 *
 * 背景：3 小时视频转出来的稿子有几千行，用户想找其中一句「反向传播」时，
 * 只能把整篇复制到别处再 Ctrl+F。而他要的往往就那几句——导出时也一样，
 * 只想导出命中的部分。这里把「在字幕里找词」和「只导出命中行」做成一层纯函数。
 *
 * 设计约束：
 * 1. 纯函数，不碰 DOM / state——Node 里能完整测试。
 * 2. 搜索是「与」语义：空格分开的多个词必须全部命中，便于一次收敛到目标句。
 * 3. 空关键词 = 不过滤（返回原样），调用方不用区分「没搜」和「全命中」。
 * 4. 脏数据（null / 非数组 / 缺 content / 时间非数字）一律跳过，不抛异常。
 */
function createSubExportModule() {
  function pad(n, w) {
    var s = String(Math.max(0, Math.floor(Number(n) || 0)));
    while (s.length < (w || 2)) s = '0' + s;
    return s;
  }

  // 秒 → HH:MM:SS.mmm（VTT 用点号分隔毫秒，与 SRT 的逗号不同，别混用）
  // 函数名刻意不叫 vttTime：主脚本已有同名解析函数，而单元测试是「按名字从源码里抠出
  // 函数体来跑」的——注入模块若与之同名，抠到的就是模块里的版本，7 条 VTT 用例会集体
  // 报 pad is not defined（v9.9 实测踩到）。同理，注释里也不要写出那个名字加左括号，
  // 否则提取正则会连注释一起抠走。
  function fmtVtt(t) {
    // 先整体换算成毫秒整数再分解：直接对秒取模会被浮点咬一口——
    // 59.9996 秒按「整数部分 + 小数部分×1000」算会得到 00:00:60.000（秒没进位到分），
    // 这是播放器直接拒收的脏时间轴。
    var totalMs = Math.round(Math.max(0, Number(t) || 0) * 1000);
    var ms = totalMs % 1000;
    var totalSec = Math.floor(totalMs / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return pad(h) + ':' + pad(m) + ':' + pad(s) + '.' + pad(ms, 3);
  }

  function isLine(x) {
    return !!x && typeof x.content === 'string' && x.content.trim() !== '' &&
           isFinite(Number(x.from)) && isFinite(Number(x.to));
  }

  function bodyToVtt(body) {
    var out = ['WEBVTT', ''];
    var arr = Array.isArray(body) ? body : [];
    var n = 0;
    for (var i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      n++;
      out.push(String(n));
      out.push(fmtVtt(arr[i].from) + ' --> ' + fmtVtt(arr[i].to));
      out.push(arr[i].content.trim().replace(/\r/g, ''));
      out.push('');
    }
    return out.join('\n');
  }

  /**
   * 在字幕里找词。
   * 返回 { body, matched, total, empty }：
   *  - body：命中行（关键词为空时原样返回，调用方无需分支）
   *  - matched / total：命中数与总行数，用于显示「命中 8 / 1240 条」
   */
  function searchBody(body, keyword) {
    var arr = Array.isArray(body) ? body : [];
    var total = 0, i;
    for (i = 0; i < arr.length; i++) if (isLine(arr[i])) total++;
    var kw = String(keyword == null ? '' : keyword).trim();
    if (!kw) return { body: arr, matched: total, total: total, filtering: false };
    var needles = kw.toLowerCase().split(/\s+/).filter(function (s) { return s; });
    var out = [];
    for (i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      var hay = arr[i].content.toLowerCase();
      var hit = true;
      for (var k = 0; k < needles.length; k++) {
        if (hay.indexOf(needles[k]) < 0) { hit = false; break; }
      }
      if (hit) out.push(arr[i]);
    }
    return { body: out, matched: out.length, total: total, filtering: true };
  }

  // 命中行的时间跨度：用于提示「这 8 条分布在 00:12 ~ 01:40」
  function spanOf(body) {
    var arr = Array.isArray(body) ? body : [];
    var min = Infinity, max = -Infinity, n = 0;
    for (var i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      n++;
      if (arr[i].from < min) min = arr[i].from;
      if (arr[i].to > max) max = arr[i].to;
    }
    if (!n) return null;
    return { from: min, to: max, count: n };
  }

  // 给 AI 用的纯文本，模块内再提供一份：调用方不必为了拿文本而绕过过滤
  function bodyToText(body) {
    var arr = Array.isArray(body) ? body : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) if (isLine(arr[i])) out.push(arr[i].content.trim());
    return out.join('\n');
  }

  // 秒 → m:ss / h:mm:ss（给人看的时间点，用于 Markdown 与跳转提示）
  function fmtClock(sec) {
    var totalSec = Math.floor(Math.max(0, Number(sec) || 0));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var mm = h ? pad(m) : String(m);
    return (h ? h + ':' : '') + mm + ':' + pad(s);
  }

  /**
   * Markdown 稿：比 TXT 更适合丢进笔记软件 / 仓库 / 给 AI 当上下文。
   * 行尾两个空格 = Markdown 软换行（否则相邻行会被渲染合并成一个大段落）。
   */
  function bodyToMd(body, meta) {
    var m = meta || {};
    var arr = Array.isArray(body) ? body : [];
    var out = ['# ' + (m.title || '字幕'), ''];
    var facts = [];
    if (m.up) facts.push('UP：' + m.up);
    if (m.lan) facts.push('字幕语言：' + m.lan);
    if (m.page && m.totalPages && m.totalPages > 1) facts.push('分 P：' + m.page + '/' + m.totalPages);
    facts.push('共 ' + arr.length + ' 条');
    if (facts.length) { out.push('> ' + facts.join(' · '), ''); }
    out.push('---', '');
    for (var i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      out.push('**[' + fmtClock(arr[i].from) + ']** ' + arr[i].content.trim() + '  ');
    }
    return out.join('\n');
  }

  /**
   * 整体平移时间轴（v9.11）。
   *
   * 场景：AI 转写出来的时间轴整体早/晚几秒（识别服务按片计算，片头片尾会累积误差），
   * 或者字幕是给另一个版本的视频配的。用户要的是「整体挪 N 秒」，不是逐条改。
   */
  function shiftBody(body, offsetSec) {
    var arr = Array.isArray(body) ? body : [];
    var off = Number(offsetSec) || 0;
    if (!off) return arr.slice();
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      // 起点不允许为负：负时间戳的 SRT 播放器直接拒收。
      // 起点被压到 0 时保持原时长，而不是把终点一起压到 0——否则前几条会变成
      // 「0 秒到 0 秒」的空条目，播放器不显示，等于把内容弄丢了。
      var dur = Math.max(0.1, arr[i].to - arr[i].from);
      var from = Math.max(0, arr[i].from + off);
      out.push({ from: from, to: from + dur, content: arr[i].content });
    }
    return out;
  }

  /**
   * 只要某个时间点之后的部分（v9.11）。
   * 场景：视频看了 40 分钟，只想导出剩下的；配合「点字幕跳转」用。
   */
  function bodyFrom(body, startSec) {
    var arr = Array.isArray(body) ? body : [];
    var start = Number(startSec) || 0;
    if (!(start > 0)) return arr.slice();
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      if (arr[i].from >= start) out.push(arr[i]);
    }
    return out;
  }

  // 区间导出：只保留 [from, to) 内的行（to 为空 = 到结尾）
  function bodyRange(body, fromSec, toSec) {
    var arr = Array.isArray(body) ? body : [];
    var a = Number(fromSec) || 0;
    var b = (toSec === undefined || toSec === null || toSec === '') ? Infinity : Number(toSec);
    if (!isFinite(b)) b = Infinity;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!isLine(arr[i])) continue;
      if (arr[i].from >= a && arr[i].from < b) out.push(arr[i]);
    }
    return out;
  }

  // v9.10 AI 总结提示词：同类脚本都有「一键生成总结提示词」，本项目以前没有——
  // 用户拿到稿子还得自己想怎么问。这里给四套现成的，点了直接复制「提示词 + 稿子」。
  var AI_PROMPTS = [
    { id: 'summary', name: '总结核心内容', text: '以下是视频字幕稿。请用 5–8 句话总结它的核心内容，保留关键结论与数字，不要复述流程。' },
    { id: 'points', name: '提取关键要点', text: '以下是视频字幕稿。请提取 8–12 条关键要点，每条一句话，按出现顺序排列，保留专有名词原文。' },
    { id: 'notes', name: '生成学习笔记', text: '以下是视频字幕稿。请整理成学习笔记：先列 3–5 个核心概念及解释，再列 3 条可立即实践的行动项。' },
    { id: 'questions', name: '生成思考问题', text: '以下是视频字幕稿。请提出 5 个能检验是否真懂的问题（含参考答案要点），难度由浅入深。' }
  ];

  function getPrompt(id) {
    for (var i = 0; i < AI_PROMPTS.length; i++) if (AI_PROMPTS[i].id === id) return AI_PROMPTS[i];
    return null;
  }

  /**
   * 拼「提示词 + 稿子」。稿子超长时截断并注明——剪贴板塞几万字既慢又可能被浏览器静默拒绝。
   */
  function buildPrompt(id, text, maxChars) {
    var p = getPrompt(id);
    if (!p) return '';
    var cap = Math.max(1000, Number(maxChars) || 15000);
    var bodyText = String(text == null ? '' : text);
    var cut = false;
    if (bodyText.length > cap) { bodyText = bodyText.slice(0, cap); cut = true; }
    return p.text + '\n\n---\n\n' + bodyText + (cut ? '\n\n（稿子过长已截断至 ' + cap + ' 字，如需完整版请导出文件）' : '');
  }

  return {
    fmtClock: fmtClock,
    bodyToMd: bodyToMd,
    shiftBody: shiftBody,
    bodyFrom: bodyFrom,
    bodyRange: bodyRange,
    AI_PROMPTS: AI_PROMPTS,
    getPrompt: getPrompt,
    buildPrompt: buildPrompt,
    vttTime: fmtVtt,     // 对外仍叫 vttTime（语义清晰），对内改名只为避开提取正则
    bodyToVtt: bodyToVtt,
    searchBody: searchBody,
    spanOf: spanOf,
    bodyToText: bodyToText
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createSubExportModule();
// </node-only>
