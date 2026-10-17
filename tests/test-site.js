'use strict';

/**
 * tests/test-site.js — v9.8 站点与页面形态覆盖（纯函数 + 接线）
 *
 * 怎么跑：
 *   node tests/test-site.js
 *
 * 为什么单独一个文件：「用户打开的页面我们认不认领」决定按钮出不出来，
 * 不认领 = 功能不存在。以前三条正则散在主脚本里，加一个站改三处且没测试，
 * 于是「网页里嵌的 B 站播放器」「自己的稍后再看列表」这些真实页面全部漏掉。
 */

var SiteMatch = require('../modules/site-match.js');
var SubExport = require('../modules/sub-export.js');
var fs = require('fs');
var path = require('path');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');
var BUILD = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('[PASS] ' + name); }
  catch (e) { failed++; console.log('[FAIL] ' + name + ' — ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}
function fnBody(name) {
  var start = SRC.indexOf('function ' + name + '(');
  if (start < 0) return '';
  var depth = 0;
  for (var i = start; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
  }
  return '';
}

// ===================== A. 认领哪些页面 =====================

test('A1 B 站七种页面形态全部认领（含以前完全不认的嵌入播放器与稍后再看）', function () {
  var forms = {
    'https://www.bilibili.com/video/BV1GJ411x7h7': 'video',
    'https://www.bilibili.com/video/av170001': 'video-av',
    'https://www.bilibili.com/bangumi/play/ep123456': 'bangumi',
    'https://www.bilibili.com/bangumi/play/ss4567': 'bangumi',
    'https://www.bilibili.com/cheese/play/ep888': 'cheese',
    'https://www.bilibili.com/list/watchlater?bvid=BV1GJ411x7h7': 'list',
    'https://www.bilibili.com/medialist/detail/ml123?type=2': 'list',
    'https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&cid=123': 'embed'
  };
  Object.keys(forms).forEach(function (u) {
    var d = SiteMatch.detect(u);
    ok(!!d, '必须认领 ' + u);
    eq(d.id, 'bilibili', u + ' 的适配器');
    eq(d.form, forms[u], u + ' 的形态');
  });
});

test('A2 YouTube 六种形态认领（含 embed / shorts / 短链 / 隐私增强）', function () {
  var forms = {
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ': 'watch',
    'https://www.youtube.com/embed/dQw4w9WgXcQ': 'embed',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ': 'shorts',
    'https://www.youtube.com/live/dQw4w9WgXcQ': 'live',
    'https://youtu.be/dQw4w9WgXcQ': 'watch',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ': 'watch'
  };
  Object.keys(forms).forEach(function (u) {
    var d = SiteMatch.detect(u);
    ok(!!d, '必须认领 ' + u);
    eq(d.id, 'youtube', u + ' 的适配器');
    eq(d.form, forms[u], u + ' 的形态');
  });
});

test('A3 没有播放器的页面不认领（认领了却取不到字幕，比不认领更伤信任）', function () {
  ['https://www.bilibili.com/',
   'https://www.bilibili.com/anime',
   'https://www.bilibili.com/v/popular/all',
   'https://live.bilibili.com/record/R1xxx',
   'https://www.bilibili.com/read/cv123',
   'https://www.youtube.com/',
   'https://www.youtube.com/watch',
   'https://youtu.be/'
  ].forEach(function (u) {
    ok(SiteMatch.detect(u) === null, '不该认领 ' + u);
  });
});

test('A4 钓鱼域名不得误认领（bilibili.com.evil.com 之类）', function () {
  ['https://bilibili.com.evil.com/video/BV1GJ411x7h7',
   'https://evil-bilibili.com/video/BV1GJ411x7h7',
   'https://www.notyoutube.com/watch?v=dQw4w9WgXcQ',
   'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'
  ].forEach(function (u) {
    ok(SiteMatch.detect(u) === null, '钓鱼域名不得认领：' + u);
  });
});

test('A5 脏输入不崩（空 / 相对 / 非 URL）', function () {
  ['', null, undefined, '/video/BV1GJ411x7h7', '不是url', 'javascript:void(0)'].forEach(function (bad) {
    ok(SiteMatch.detect(bad) === null, '脏输入不得认领：' + JSON.stringify(bad));
    var p = SiteMatch.videoParams(bad);
    ok(p && typeof p.bvid === 'string', 'videoParams 必须返回对象');
  });
});

// ===================== B. 视频参数抽取（嵌入播放器 / 列表页的关键） =====================

test('B1 嵌入播放器：视频号只在查询串里，必须抽得出来', function () {
  var p = SiteMatch.videoParams('https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&cid=998877&p=3');
  eq(p.bvid, 'BV1GJ411x7h7', 'bvid');
  eq(p.cid, '998877', 'cid');
  eq(p.page, 3, 'page');
});

test('B2 稍后再看 / 收藏夹：同样只带 bvid 参数', function () {
  var p = SiteMatch.videoParams('https://www.bilibili.com/list/watchlater?bvid=BV1yx411c7mD');
  eq(p.bvid, 'BV1yx411c7mD', 'bvid');
  eq(p.page, 1, '默认 P1');
});

test('B3 普通视频页：pathname 里的 BV 也要抽得到，p 参数照旧', function () {
  var p = SiteMatch.videoParams('https://www.bilibili.com/video/BV1GJ411x7h7?p=5');
  eq(p.bvid, 'BV1GJ411x7h7', 'bvid');
  eq(p.page, 5, 'p');
  var q = SiteMatch.videoParams('https://www.bilibili.com/video/av170001?p=2');
  eq(q.aid, '170001', 'aid');
});

test('B4 参数消毒：非法 bvid / 非数字 cid / 负数 p 一律退化', function () {
  var p = SiteMatch.videoParams('https://x.com/?bvid=<script>&cid=abc&p=-3');
  eq(p.bvid, '', '非法 bvid 必须丢弃（防注入）');
  eq(p.cid, '', '非数字 cid 必须丢弃');
  eq(p.page, 1, '非法 p 退化为 1');
});

// ===================== C. 接线 =====================

test('C1 两个站点适配器改用 SiteMatch 认领（不是各写各的正则）', function () {
  ok(/match: function \(\) \{ var d = SiteMatch\.detect\(location\.href\); return !!d && d\.id === 'bilibili'; \}/.test(SRC), 'B 站要走 SiteMatch');
  ok(/match: function \(\) \{ var d = SiteMatch\.detect\(location\.href\); return !!d && d\.id === 'youtube'; \}/.test(SRC), 'YouTube 要走 SiteMatch');
});

test('C2 入口可见性判定也走 SiteMatch（认领的站就一定出按钮）', function () {
  ok(/function isSupportedSite\(\)[\s\S]{0,160}SiteMatch\.isCovered\(location\.href\)/.test(SRC), 'isSupportedSite 要用 isCovered');
  ok(/adapters\.html5\.match\(\)/.test(fnBody('isSupportedSite')), '通用站点仍由 video 探测兜底');
});

test('C3 B 站 resolve 真的用 URL 参数补视频号（否则嵌入播放器认领了也取不到）', function () {
  // resolve 是对象方法（resolve: async function () {...}），不能用 fnBody('resolve') 取，
  // 直接对整份源码断言调用点与三个字段的使用。
  ok(/var up = SiteMatch\.videoParams\(location\.href\);/.test(SRC), '必须调用 videoParams');
  ok(/if \(!state\.bvid && up\.bvid\) state\.bvid = up\.bvid;/.test(SRC), '要用 up.bvid');
  ok(/if \(!state\.cid && up\.cid\) state\.cid = up\.cid;/.test(SRC), '要用 up.cid');
  ok(/if \(!state\.aid && up\.aid\) state\.aid = up\.aid;/.test(SRC), '要用 up.aid');
  ok(/state\.page = up\.page \|\| 1;/.test(SRC), '分 P 也要用抽出来的值');
});

test('C4 html5 适配器不再只认第一个 video（遍历全部，优先带轨道的）', function () {
  var body = SRC.slice(SRC.indexOf('adapters.html5 = {'), SRC.indexOf('adapters.html5 = {') + 2200);
  ok(/querySelectorAll\('video'\)/.test(body), '必须遍历所有 video');
  ok(/querySelectorAll\('track'\)/.test(body), '要看每个 video 的 track');
  ok(/sort\(function \(a, b\)/.test(body) || /\.sort\(/.test(body), '无轨道时按时长选主视频');
});

test('C5 build.js 注册 site-match 模块', function () {
  ok(BUILD.indexOf('site-match.js') >= 0, 'build.js 要列出');
  ok(/var SiteMatch = createSiteMatchModule\(\);/.test(SRC), '主脚本要实例化');
  ok(SRC.indexOf('function createSiteMatchModule()') >= 0, '模块源码要注入');
  var b = SRC.indexOf('// <build:modules>'), e = SRC.indexOf('// </build:modules>');
  ok(SRC.slice(b, e).indexOf('createSiteMatchModule') >= 0, '必须在 build 区内');
});

test('C6 认领规则表自带说明（加站的人知道自己在加什么）', function () {
  SiteMatch.RULES.forEach(function (r) {
    ok(!!r.id && !!r.form && !!r.note, '每条规则都要有 id / form / note');
    ok(r.host instanceof RegExp && r.path instanceof RegExp, 'host 与 path 必须是正则');
  });
  ok(SiteMatch.RULES.length >= 12, '规则数不应少于 12，实际 ' + SiteMatch.RULES.length);
});

// ===================== D. v9.13 JS 挂的字幕轨（textTracks） =====================

function cue(start, end, text) { return { startTime: start, endTime: end, text: text }; }

test('D1 cuesToBody：把 TextTrack 的 cue 转成标准字幕（含去标签）', function () {
  var cues = [cue(0, 2, '第一句'), cue(2, 4, '<i>第二句</i> 带标签')];
  var body = SubExport.cuesToBody(cues);
  eq(body.length, 2, '条数');
  eq(body[0].content, '第一句', '第一句');
  eq(body[1].content, '第二句 带标签', '标签必须剥掉');
  eq(body[1].from, 2, '起点');
  eq(body[1].to, 4, '终点');
});

test('D2 cuesToBody：空 cue 丢掉（否则导出一堆空行）', function () {
  var body = SubExport.cuesToBody([cue(0, 2, '有效'), cue(2, 4, '   '), cue(4, 6, '')]);
  eq(body.length, 1, '只剩有效那条');
});

test('D3 cuesToBody：结束时间缺失/倒挂时兜底 2 秒，绝不写 0', function () {
  var body = SubExport.cuesToBody([cue(1, 0, '结束早于开始'), cue(3, null, '没有结束时间')]);
  body.forEach(function (x, i) {
    ok(x.to > x.from, '第 ' + i + ' 条 to 必须大于 from（实际 ' + x.to + ' / ' + x.from + '）');
  });
});

test('D4 cuesToBody：按起点排序（JS 挂的轨道顺序未必有序）', function () {
  var body = SubExport.cuesToBody([cue(5, 6, '后'), cue(0, 1, '先')]);
  ok(body[0].from <= body[1].from, '必须按时间排好');
  eq(body[0].content, '先', '第一条');
});

test('D5 cuesToBody：脏输入不崩（null / 非数组 / 缺字段）', function () {
  eq(SubExport.cuesToBody(null).length, 0, 'null');
  eq(SubExport.cuesToBody('不是数组').length, 0, '字符串');
  eq(SubExport.cuesToBody([null, {}, cue(0, 1, '有效')]).length, 1, '缺字段的跳过');
});

test('D6 接线：html5 适配器在 DOM track 为空时会去查 video.textTracks', function () {
  var zone = SRC.slice(SRC.indexOf('adapters.html5 = {'), SRC.indexOf('adapters.html5 = {') + 4000);
  ok(/textTracks/.test(zone), '必须访问 textTracks');
  ok(/SubExport\.cuesToBody\(tt\.cues\)/.test(zone), '必须用 cuesToBody 转换');
  ok(/if \(!tt\.cues \|\| !tt\.cues\.length\) continue;/.test(zone), '空轨道要跳过');
});

test('D7 接线：只在 DOM track 拿不到时才用 textTracks（不重复、不覆盖）', function () {
  var zone = SRC.slice(SRC.indexOf('adapters.html5 = {'), SRC.indexOf('adapters.html5 = {') + 4000);
  ok(/if \(!Object\.keys\(byLan\)\.length && v\.textTracks/.test(zone), '必须是有 DOM track 就不走这条');
});

test('D8 接线：选视频时也认 textTracks（有 JS 轨道的 video 优先于最长的那个）', function () {
  var zone = SRC.slice(SRC.indexOf('adapters.html5 = {'), SRC.indexOf('adapters.html5 = {') + 4000);
  ok(/vids\[vj\]\.textTracks/.test(zone), '选视频阶段也要看 textTracks');
});

test('D9 接线：getSubBody 对没有 URL 的 cues 轨道直接取内存内容（不用发请求）', function () {
  // 必须从 html5 适配器那段里找：YouTube 适配器也有同名方法，取第一个会验错对象
  var h5 = SRC.slice(SRC.indexOf('adapters.html5 = {'));
  var zone = h5.slice(h5.indexOf('getSubBody'), h5.indexOf('getSubBody') + 700);
  ok(/if \(sub\.cues && sub\.cues\.length\)/.test(zone), '要优先用内存 cues');
  ok(/mergeBodies\(\[\{ body: sub\.cues \}\]\)/.test(zone), '直接合并，不下载');
});

test('D10 反向断言：不允许把 cueless 轨道（kind 不对 / 空 cues）也建卡', function () {
  var zone = SRC.slice(SRC.indexOf('adapters.html5 = {'), SRC.indexOf('adapters.html5 = {') + 4000);
  ok(/if \(kk && kk !== 'subtitles' && kk !== 'captions'\) continue;/.test(zone), 'kind 不对要跳过');
  ok(/if \(!cues\.length\) continue;/.test(zone), '转出来是空的要跳过');
});

console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) { console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情'); process.exit(1); }
console.log('全部通过，退出码 0');
process.exit(0);
