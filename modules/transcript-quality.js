'use strict';

function createTranscriptQualityModule() {
  function normalizeText(text) {
    return String(text == null ? '' : text).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  function splitTerms(value) {
    if (Array.isArray(value)) return value.reduce(function (all, item) { return all.concat(splitTerms(item)); }, []);
    return String(value || '').split(/[\n,，、;；|/]+|\s{2,}/).map(normalizeText).filter(Boolean);
  }

  function buildHotwords(meta, customTerms) {
    meta = meta || {};
    var raw = [];
    raw.push(meta.title, meta.author || meta.up, meta.typename || meta.category);
    raw = raw.concat(splitTerms(meta.tags));
    raw = raw.concat(splitTerms(customTerms));
    // 标题和简介本身就是最相关的免费上下文；只取短片段，避免把长简介整体塞进请求。
    raw = raw.concat(splitTerms(String(meta.title || '').replace(/[：:｜|【】()[\]（）—_-]+/g, '，')));
    raw = raw.concat(splitTerms(String(meta.desc || meta.description || '').slice(0, 320).replace(/[。！？!?：:｜|【】()[\]（）—_-]+/g, '，')));
    var seen = {}, out = [];
    raw.forEach(function (term) {
      term = normalizeText(term).replace(/^[,，.。]+|[,，.。]+$/g, '');
      if (term.length < 2 || term.length > 32) return;
      var key = term.toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(term); }
    });
    return out.slice(0, 80);
  }

  function overlapLength(left, right) {
    var max = Math.min(left.length, right.length, 30);
    for (var n = max; n >= 2; n--) if (left.slice(-n) === right.slice(0, n)) return n;
    return 0;
  }

  function dedupeAdjacentCues(body) {
    var out = [];
    (body || []).forEach(function (cue) {
      var text = normalizeText(cue && cue.content);
      if (!text) return;
      var current = { from: Number(cue.from) || 0, to: Number(cue.to) || Number(cue.from) || 0, content: text };
      if (!out.length) { out.push(current); return; }
      var prev = out[out.length - 1];
      if (text === prev.content || prev.content.indexOf(text) >= 0) {
        prev.to = Math.max(prev.to, current.to);
        return;
      }
      if (text.indexOf(prev.content) === 0 && text.length > prev.content.length) {
        prev.content = text;
        prev.to = Math.max(prev.to, current.to);
        return;
      }
      var overlap = overlapLength(prev.content, text);
      if (overlap) current.content = text.slice(overlap).trim();
      if (!current.content) { prev.to = Math.max(prev.to, current.to); return; }
      out.push(current);
    });
    return out;
  }

  function textLength(text) { return normalizeText(text).replace(/[\s，。！？；：,.!?;:]/g, '').length; }
  function hasEndPunctuation(text) { return /[。！？!?；;…]$/.test(text); }

  function addLocalPunctuation(text, gap, final) {
    text = normalizeText(text);
    if (!text || /[，。！？；：,.!?;:…]$/.test(text)) return text;
    if (/(吗|么|呢|是不是|为什么|怎么|怎样|多少|哪里|哪儿|谁|何时|多久)$/i.test(text)) return text + '？';
    if (final || gap >= 1.4) return text + '。';
    if (/(啊|呀|吧|哦|啦|嘛|那么|然后|所以|但是|不过)$/i.test(text) || gap >= 0.65) return text + '，';
    return text;
  }

  function polishBody(body, options) {
    options = options || {};
    var cues = dedupeAdjacentCues(body);
    if (options.punctuation === false) return cues;
    var out = [], current = null;

    function flushCurrent() {
      if (!/[。！？!?…]$/.test(current.content)) current.content = current.content.replace(/[，,；;]+$/, '') + '。';
      out.push(current);
      current = null;
    }

    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var next = cues[i + 1];
      var gap = next ? Math.max(0, next.from - cue.to) : 2;
      var content = addLocalPunctuation(cue.content, gap, !next);
      // 为什么：原先只在追加后检查 40 字上限，一条 5 字碎片会把 35 字的句子顶到 40 字以上
      // （实测冲出 43 字）。改成追加前预判：当前已够 15 字且追加后越界，就先就地断句，
      // 保证自然句稳定落在 15–40 字；不足 15 字的短句仍继续攒，避免碎句。
      if (current && current.content && textLength(current.content) >= 15 &&
          textLength(current.content) + textLength(content) > 40) {
        flushCurrent();
      }
      if (!current) current = { from: cue.from, to: cue.to, content: '' };
      if (current.content && !/[，。！？；：,.!?;:…]$/.test(current.content)) current.content += '，';
      current.content += content;
      current.to = Math.max(current.to, cue.to);
      var length = textLength(current.content);
      var naturalEnd = hasEndPunctuation(content);
      if ((naturalEnd && length >= 15) || length >= 40 || !next) {
        flushCurrent();
      }
    }
    return out;
  }

  function bodyToAiText(body) {
    return polishBody(body, { punctuation: true }).map(function (cue) { return cue.content; }).join('\n');
  }

  function anchorTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return String(n).padStart(2, '0'); }
    return h ? p(h) + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }

  function bodyToAnchoredText(body, anchorSec) {
    anchorSec = Math.max(180, Math.min(300, Number(anchorSec) || 240));
    var polished = polishBody(body, { punctuation: true });
    var groups = [], current = null;
    polished.forEach(function (cue) {
      var bucket = Math.floor((Number(cue.from) || 0) / anchorSec);
      if (!current || current.bucket !== bucket) {
        current = { bucket: bucket, from: Number(cue.from) || bucket * anchorSec, parts: [] };
        groups.push(current);
      }
      current.parts.push(cue.content);
    });
    return groups.map(function (group) { return '[' + anchorTime(group.from) + ']\n' + group.parts.join(''); }).join('\n\n');
  }

  function buildCorrectionPrompt(body, meta, customTerms) {
    meta = meta || {};
    var rows = (body || []).map(function (cue, index) { return { index: index, content: normalizeText(cue.content) }; });
    return [
      '你是字幕校对器，只能修正错别字、同音字和专有名词。',
      '严禁改写句式、调整语序、概括、扩写、删减信息或合并拆分条目。',
      '必须保持 corrected 数组的 index、顺序和条目数完全不变。',
      '输出严格 JSON：{"corrected":[{"index":0,"content":"..."}],"changes":[{"from":"原词","to":"改词"}]}，无修改时 changes=[]。不要输出 Markdown。',
      '视频标题：' + normalizeText(meta.title),
      '简介：' + normalizeText(meta.desc || meta.description).slice(0, 500),
      '作者/UP主：' + normalizeText(meta.author || meta.up),
      '分区与标签：' + normalizeText([meta.typename || meta.category, meta.tags].filter(Boolean).join('，')),
      '自定义术语：' + splitTerms(customTerms).join('，'),
      '待校对字幕：' + JSON.stringify(rows)
    ].join('\n');
  }

  function parseCorrectionResponse(text, originalBody) {
    var source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('LLM 纠错响应不是 JSON');
    var data = JSON.parse(match[0]);
    if (!Array.isArray(data.corrected) || data.corrected.length !== (originalBody || []).length) throw new Error('LLM 纠错返回条目数改变，已拒绝应用');
    var body = data.corrected.map(function (row, index) {
      if (Number(row.index) !== index) throw new Error('LLM 纠错返回顺序改变，已拒绝应用');
      var original = originalBody[index];
      var content = normalizeText(row.content);
      if (!content) throw new Error('LLM 纠错产生空字幕，已拒绝应用');
      return { from: original.from, to: original.to, content: content };
    });
    var changes = Array.isArray(data.changes) ? data.changes.map(function (change) {
      return { from: normalizeText(change.from), to: normalizeText(change.to) };
    }).filter(function (change) { return change.from && change.to && change.from !== change.to; }) : [];
    return { body: body, changes: changes };
  }

  return {
    buildHotwords: buildHotwords,
    dedupeAdjacentCues: dedupeAdjacentCues,
    polishBody: polishBody,
    bodyToAiText: bodyToAiText,
    bodyToAnchoredText: bodyToAnchoredText,
    buildCorrectionPrompt: buildCorrectionPrompt,
    parseCorrectionResponse: parseCorrectionResponse
  };
}

// <node-only>
if (typeof module !== 'undefined' && module.exports) module.exports = createTranscriptQualityModule();
// </node-only>
