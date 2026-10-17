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

  return {
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
