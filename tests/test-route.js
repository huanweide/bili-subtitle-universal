'use strict';

/**
 * tests/test-route.js — v9.6 路由身份 + 导出动作（纯 Node 单测 + 源码接线断言）
 *
 * 怎么跑：
 *   node tests/test-route.js
 *
 * 覆盖两类东西：
 *   A. modules/route-identity.js 纯函数：锚点/追踪参数不算换视频、分 P 算换、
 *      番剧 ep/ss、YouTube（含 youtu.be 短链）、通用站点、脏输入不崩。
 *   B. 源码接线：主脚本必须真的用上这些能力（v9.1 的教训——模块写了没接线等于没做），
 *      并且必须不再出现「复制 + 下载双触发」「整条 href 比对」这两个已修掉的 bug。
 *
 * 成功退出码 0，任一断言失败立即打印详情并退出 1。
 */

var RouteIdentity = require('../modules/route-identity.js');

var fs = require('fs');
var path = require('path');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');
var BUILD = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');

// ---------- 迷你断言框架 ----------
var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('[PASS] ' + name);
  } catch (error) {
    failed++;
    console.log('[FAIL] ' + name + ' — ' + error.message);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a));
}

// 源码里某标识符出现次数
function countOf(id, src) {
  var re = new RegExp('\\b' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  return (((src || SRC).match(re)) || []).length;
}
// 提取函数体（大括号配对）
function fnBody(name, src) {
  var s = src || SRC;
  var start = s.indexOf('function ' + name + '(');
  if (start < 0) return '';
  var depth = 0, i;
  for (i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return '';
}

// ===================== A. 模块纯函数 =====================

var B1 = 'https://www.bilibili.com/video/BV1GJ411x7h7';
var B2 = 'https://www.bilibili.com/video/BV1yx411c7mD';

test('A1 只加时间戳锚点 ?t=120（评论区时间戳 / 章节跳转）不算换视频——这是本轮要修的误伤', function () {
  ok(RouteIdentity.isSameVideo(B1, B1 + '?t=120'), '?t= 必须判为同一条视频');
  ok(RouteIdentity.isSameVideo(B1 + '?p=1', B1 + '?p=1&t=45'), '已有 p 再加 t 也必须同一条');
});

test('A2 分享/归因参数（spm_id_from / vd_source / from_spmid / unique_k）不算换视频', function () {
  var noisy = B1 + '?spm_id_from=333.999.0.0&vd_source=abc123&from_spmid=666&unique_k=xyz';
  ok(RouteIdentity.isSameVideo(B1, noisy), '追踪参数必须被忽略');
  ok(RouteIdentity.isSameVideo(B1 + '?t=30', noisy + '&t=999'), '追踪参数 + 锚点混合也必须忽略');
});

test('A3 换分 P 必须算换（?p=2 是另一条 cid，字幕不同）', function () {
  ok(!RouteIdentity.isSameVideo(B1 + '?p=1', B1 + '?p=2'), '换 P 不能当同一条');
  ok(RouteIdentity.isSameVideoFamily(B1 + '?p=1', B1 + '?p=2'), '但必须认出是「同一条视频换 P」');
  ok(!RouteIdentity.isSameVideoFamily(B1, B2), '不同视频不能误判成换 P');
});

test('A4 换了整条视频：既不是同一条，也不是同一族', function () {
  ok(!RouteIdentity.isSameVideo(B1, B2), '不同 BV 必须换');
  ok(!RouteIdentity.isSameVideoFamily(B1, B2), '不同 BV 不能是同族');
});

test('A5 分 P 号解析：缺省 1、非法值退化 1、p=3 读到 3', function () {
  eq(RouteIdentity.pageOf(B1), 1, '缺省');
  eq(RouteIdentity.pageOf(B1 + '?p=3'), 3, 'p=3');
  eq(RouteIdentity.pageOf(B1 + '?p=0'), 1, 'p=0 非法');
  eq(RouteIdentity.pageOf(B1 + '?p=abc'), 1, 'p=abc 非法');
  eq(RouteIdentity.pageOf(B1 + '?p=-5'), 1, '负数非法');
});

test('A6 B 站 av 号与番剧 ep/ss 都能识别，且锚点不影响', function () {
  var av = 'https://www.bilibili.com/video/av170001';
  ok(RouteIdentity.isSameVideo(av, av + '?t=90'), 'av 号也要认');
  var ep = 'https://www.bilibili.com/bangumi/play/ep123456';
  ok(RouteIdentity.isSameVideo(ep, ep + '?t=60&spm_id_from=1'), '番剧 ep 锚点不误伤');
  eq(RouteIdentity.siteOf(ep), 'bilibili', '番剧归属 bilibili');
  var ss = 'https://www.bilibili.com/bangumi/play/ss4567';
  ok(RouteIdentity.isSameVideo(ss, ss + '?t=60'), '番剧 ss 锚点不误伤');
});

test('A7 YouTube：v 参数 / 短链 / shorts 都能认，t 不影响', function () {
  var y1 = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  ok(RouteIdentity.isSameVideo(y1, y1 + '&t=42s'), 'YouTube ?t= 不误伤');
  ok(RouteIdentity.isSameVideo(y1, 'https://youtu.be/dQw4w9WgXcQ?t=42'), 'youtu.be 短链同一条');
  ok(RouteIdentity.isSameVideo(y1, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxx&index=2') === false ||
     RouteIdentity.siteOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxx') === 'youtube', 'list 参数不改变站点归属');
  ok(!RouteIdentity.isSameVideo(y1, 'https://www.youtube.com/watch?v=aaaaaaaaaaa'), '换 ID 必须换');
  var sh = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
  eq(RouteIdentity.siteOf(sh), 'youtube', 'shorts 归属 youtube');
});

test('A8 通用站点：锚点不误伤，路径变了才算换', function () {
  var g = 'https://example.com/lesson/42';
  ok(RouteIdentity.isSameVideo(g, g + '?t=300'), '通用站 ?t= 不误伤');
  ok(RouteIdentity.isSameVideo(g, g + '?utm_source=wx&fbclid=zz'), 'UTM 不误伤');
  ok(!RouteIdentity.isSameVideo(g, 'https://example.com/lesson/43'), '换路径必须换');
  eq(RouteIdentity.siteOf(g), 'generic', '通用站归类');
});

test('A9 hash 变化（#评论 / #reply）不算换视频', function () {
  ok(RouteIdentity.isSameVideo(B1, B1 + '#reply-123'), 'B 站 hash 不误伤');
  ok(RouteIdentity.isSameVideo('https://example.com/v/1', 'https://example.com/v/1#sec2'), '通用站 hash 不误伤');
});

test('A10 脏输入不崩：空串 / 相对路径 / 非 URL 字符串一律返回字符串身份', function () {
  ['', null, undefined, '/video/BV1GJ411x7h7', '不是url', 'javascript:void(0)'].forEach(function (bad) {
    var id = RouteIdentity.identity(bad);
    ok(typeof id === 'string', '身份必须是字符串，实际 ' + typeof id + '（输入 ' + JSON.stringify(bad) + '）');
    var fam = RouteIdentity.family(bad);
    ok(typeof fam === 'string', '族必须是字符串');
    ok(RouteIdentity.isSameVideo(bad, bad) === true || bad === '' || bad === null || bad === undefined, '同输入必须自等（空值除外）');
  });
  // 相对路径也要能剥锚点，不能因为解析失败就把 t 留在身份里
  ok(RouteIdentity.identity('/video/BV1GJ411x7h7?t=60') === RouteIdentity.identity('/video/BV1GJ411x7h7'),
    '相对路径同样忽略 ?t=');
});

test('A11 cleanUrl 生成干净地址（去锚点与追踪参数，保留 p）', function () {
  var c = RouteIdentity.cleanUrl(B1 + '?p=2&t=120&spm_id_from=333.999');
  ok(c.indexOf('t=120') < 0, '不能残留 t');
  ok(c.indexOf('spm_id_from') < 0, '不能残留 spm');
  ok(c.indexOf('p=2') >= 0, '必须保留分 P');
});

test('A12 身份串本身稳定：同一 URL 多次解析结果一致（可当缓存键）', function () {
  eq(RouteIdentity.identity(B1 + '?p=2'), RouteIdentity.identity(B1 + '?p=2'), '幂等');
  ok(RouteIdentity.identity(B1 + '?p=2').indexOf(':p2') >= 0, '身份串里带分 P 标记');
});

test('A13 追踪参数表必须含 t 与主流归因参数（漏一个 = 一次误伤）', function () {
  var tp = RouteIdentity.TRACKING_PARAMS;
  ['t', 'spm_id_from', 'vd_source', 'from_spmid', 'utm_source', 'fbclid'].forEach(function (k) {
    ok(tp.indexOf(k) >= 0, '追踪表必须含 ' + k);
  });
});

// ===================== B. 源码接线（写了没接 = 没做） =====================

test('B1 主脚本真的用身份比对，而不是拿整条 href 比对', function () {
  ok(/RouteIdentity\.isSameVideo\(/.test(SRC), '必须调用 isSameVideo');
  ok(/RouteIdentity\.isSameVideoFamily\(/.test(SRC), '必须调用 isSameVideoFamily（区分换 P 与换视频）');
  // 反向：boot 里不得再出现「href 不等就 reset」的旧写法
  var bootBody = fnBody('boot');
  ok(bootBody.length > 0, '要能取到 boot 函数体');
  ok(!/location\.href\s*!==\s*last[\s\S]{0,120}resetForNewVideo/.test(bootBody), 'boot 里不许再直接 reset');
});

test('B2 resetForNewVideo 只被 handleRouteChange 调用（换视频的入口收敛到一处）', function () {
  eq(countOf('resetForNewVideo'), 2, '定义 1 + 调用 1');
  ok(/function handleRouteChange\(/.test(SRC), '必须有 handleRouteChange');
  ok(fnBody('handleRouteChange').indexOf('resetForNewVideo') >= 0, 'reset 必须发生在 handleRouteChange 内');
});

test('B3 锚点不变时明确「什么都不做」并写日志（不是静默放行）', function () {
  var body = fnBody('handleRouteChange');
  ok(/log\(/.test(body), '要留一条日志便于排查');
  // 必须写成真正的 if 条件。M3 变异（if (false && RouteIdentity.isSameVideo(...))）
  // 让旧版这条断言假绿——只查「字符串在不在」不算数，得查它是不是真的在判。
  ok(/if \(RouteIdentity\.isSameVideo\(prevHref, nextHref\)\) \{/.test(body), '必须是无遮挡的 if 判断');
  ok(body.indexOf('false && RouteIdentity') < 0, '不许用短路绕过身份比对');
  // 顺序断言：先判同、后 reset。反过来实现等于先清空再问「是不是同一条」，字幕已经没了。
  var iSame = body.indexOf('isSameVideo');
  var iReset = body.indexOf('resetForNewVideo');
  ok(iSame >= 0 && iReset > iSame, '必须先判同一条视频，再决定是否 reset');
});

test('B4 换 P 自动重取：受设置控制，且只取字幕不碰 ASR', function () {
  var body = fnBody('handleRouteChange');
  ok(/autoFetchOnPageSwitch/.test(body), '必须读设置开关');
  ok(/getSubtitles\(\)/.test(body), '换 P 后必须自动取字幕');
  ok(!/runAsr\(\)/.test(body), '换 P 不得顺手起 ASR（会烧额度）');
});

test('B5 分 P 号在 reset 时从 URL 读（导出文件名才不会一直写 P1）', function () {
  var body = fnBody('resetForNewVideo');
  ok(/RouteIdentity\.pageOf\(location\.href\)/.test(body), 'reset 里必须读 pageOf');
});

test('B6 「换 P 自动获取」设置项：读取 / 保存 / 回填三处齐全', function () {
  ok(/autoFetchOnPageSwitch: GM_getValue\('bsr_auto_fetch_page', true\)/.test(SRC), '要有默认值 true 的读取');
  ok(/GM_setValue\('bsr_auto_fetch_page', SETTINGS\.autoFetchOnPageSwitch\)/.test(SRC), '要落盘');
  ok(/#bsrAutoFetchPage'\)\.checked = SETTINGS\.autoFetchOnPageSwitch/.test(SRC), '要回填 UI');
  ok(/id="bsrAutoFetchPage"/.test(SRC), '设置面板要有这个控件');
  ok(/SETTINGS\.autoFetchOnPageSwitch = root\.querySelector\('#bsrAutoFetchPage'\)\.checked/.test(SRC), '保存时要读 UI 值');
});

test('B7 导出动作统一走 emitExport（复制/下载分派到一处，不许各写各的）', function () {
  ok(/function emitExport\(/.test(SRC), '要有 emitExport');
  ok(countOf('emitExport') >= 3, '定义 1 + 两个导出按钮各 1，实际 ' + countOf('emitExport'));
  ok(fnBody('exportAiText').indexOf('emitExport') >= 0, 'AI 文本要走 emitExport');
  ok(fnBody('exportAnchored').indexOf('emitExport') >= 0, '锚点稿要走 emitExport');
});

test('B8 反向断言：导出函数体内不许再「复制 + 下载」双触发（旧 bug）', function () {
  [fnBody('exportAiText'), fnBody('exportAnchored')].forEach(function (b) {
    ok(b.indexOf('copyText') < 0, '导出函数不得直接 copyText（应交给 emitExport）');
    ok(b.indexOf('download(') < 0, '导出函数不得直接 download（应交给 emitExport）');
  });
  var eb = fnBody('emitExport');
  ok(/exportMode/.test(eb), 'emitExport 必须读 exportMode');
  ok(/mode === 'copy' \|\| mode === 'both'/.test(eb), 'copy 模式才复制');
  ok(/mode === 'download' \|\| mode === 'both'/.test(eb), 'download 模式才下载');
});

test('B9 导出模式设置项：读取 / 保存 / 回填 / 三档选项齐全，默认 copy', function () {
  ok(/exportMode: GM_getValue\('bsr_export_mode', 'copy'\)/.test(SRC), '默认必须是 copy');
  ok(/GM_setValue\('bsr_export_mode', SETTINGS\.exportMode\)/.test(SRC), '要落盘');
  ok(/#bsrExportMode'\)\.value = SETTINGS\.exportMode/.test(SRC), '要回填 UI');
  ok(/value="copy"/.test(SRC) && /value="download"/.test(SRC) && /value="both"/.test(SRC), '三档选项都要有');
});

test('B10 主按钮（📋复制 / TXT / SRT）不受导出模式影响：复制纯复制、下载纯下载', function () {
  var copy = /#bsrCopy'\)\.onclick = function \(\) \{ copyText\(/.test(SRC);
  ok(copy, '复制按钮必须只 copyText');
  var txtLine = SRC.match(/#bsrTxt'\)\.onclick[\s\S]{0,220}?;/);
  ok(!!txtLine && txtLine[0].indexOf('download(') >= 0 && txtLine[0].indexOf('copyText') < 0, 'TXT 按钮必须只 download');
});

test('B11 build.js 必须注册 route-identity 模块（否则改了模块不会进主脚本）', function () {
  ok(BUILD.indexOf('route-identity.js') >= 0, 'build.js 要列出新模块');
  ok(BUILD.indexOf('createRouteIdentityModule()') >= 0, 'build.js 要实例化');
  ok(/var RouteIdentity = createRouteIdentityModule\(\);/.test(SRC), '主脚本里要有实例化语句');
  ok(SRC.indexOf('function createRouteIdentityModule()') >= 0, '模块源码要真的注入进主脚本');
});

test('B12 新模块源码在主脚本 build:modules 区内（手改区外会被 build 覆盖）', function () {
  var b = SRC.indexOf('// <build:modules>');
  var e = SRC.indexOf('// </build:modules>');
  ok(b >= 0 && e > b, '要有 build:modules 标记');
  var zone = SRC.slice(b, e);
  ok(zone.indexOf('createRouteIdentityModule') >= 0, 'route-identity 必须在标记区内');
  ok(SRC.slice(0, b).indexOf('createRouteIdentityModule') < 0, '标记区外不得有第二份');
});

// ---------- 汇总 ----------
console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) {
  console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情');
  process.exit(1);
}
console.log('全部通过，退出码 0');
process.exit(0);
