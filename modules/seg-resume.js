'use strict';

/**
 * 分段转写断点续传的状态层（v9.4）。
 *
 * 背景：3 小时长视频走分段解码，一批约 2 分钟音频，全程上百批。断网、误关标签页、
 * 主动取消后重来一遍 = 重新花钱花时间。这里把「已完成到第几批 + 已转出的文字」
 * 落进 GM 存储，同一条视频（bvid + cid + 音频地址）下次自动接着跑。
 *
 * 设计约束：
 * 1. 纯函数，GM_setValue / GM_getValue 由调用方注入——Node 里能完整测试，
 *    不碰浏览器存储。
 * 2. 一切从磁盘读回来的东西都按脏数据对待：JSON 坏、字段缺、形状不对、
 *    超 24 小时、换了一条视频——一律当没有断点，绝不把脏数据带进字幕。
 * 3. 存储键只有一个（bsr_seg_resume），值里自带视频标识，不搞键空间膨胀。
 */
function createSegResumeModule() {
  var KEY = 'bsr_seg_resume';
  var TTL_MS = 24 * 3600 * 1000;        // 断点只保留 24 小时：B 站音频地址带签名会过期，续太久的断点没有意义
  var MAX_BYTES = 3 * 1024 * 1024;      // 3MB 上限：3 小时中文转写约 250KB，这个坎永远摸不到，纯防御

  function normCid(cid) { return cid == null ? '' : String(cid); }

  // 同一条视频的判定：bvid + cid + 音频地址三者全同。音频地址里带签名参数，
  // 地址变了说明是重新取的流，旧断点的字节偏移全部作废，必须整体重来。
  function sameRun(st, bvid, cid, url) {
    return !!st && st.bvid === (bvid || '') && normCid(st.cid) === normCid(cid) && st.url === (url || '');
  }

  function sanitizeSegs(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var x = raw[i];
      if (!x || typeof x.content !== 'string' || !x.content) continue;
      var from = Number(x.from), to = Number(x.to);
      if (!isFinite(from) || !isFinite(to)) continue;
      out.push({ from: from, to: to, content: x.content });
    }
    return out;
  }

  /**
   * 读断点。返回 null = 没有可用断点（全新开始）；
   * 返回 { doneCount, segs } = 前 doneCount 批已完成，segs 是已转出的文字。
   */
  function loadResume(getValue, now, bvid, cid, url) {
    var raw = getValue(KEY, '');
    if (!raw || typeof raw !== 'string') return null;
    var st = null;
    try { st = JSON.parse(raw); } catch (e) { return null; }   // 存储被写坏：当没有
    if (!st || typeof st !== 'object') return null;
    // 时钟回拨（now < t）同样视为过期，不跟用户时钟较劲
    if (!(now - (Number(st.t) || 0) >= 0 && now - (Number(st.t) || 0) < TTL_MS)) return null;
    if (!sameRun(st, bvid, cid, url)) return null;
    var done = Number(st.doneCount);
    if (!isFinite(done) || done < 0) return null;
    return { doneCount: Math.floor(done), segs: sanitizeSegs(st.segs) };
  }

  /**
   * 写断点。返回 false = 超限没写（调用方应记一笔，不能让用户以为存上了）。
   */
  function saveResume(setValue, now, bvid, cid, url, doneCount, segs) {
    var st = {
      t: now,
      bvid: bvid || '',
      cid: normCid(cid),
      url: url || '',
      doneCount: Math.max(0, Math.floor(Number(doneCount) || 0)),
      segs: sanitizeSegs(segs)
    };
    var raw = JSON.stringify(st);
    if (raw.length > MAX_BYTES) return false;
    setValue(KEY, raw);
    return true;
  }

  function clearResume(setValue) { setValue(KEY, ''); }

  return {
    KEY: KEY,
    TTL_MS: TTL_MS,
    loadResume: loadResume,
    saveResume: saveResume,
    clearResume: clearResume
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createSegResumeModule();
// </node-only>
