'use strict';

/**
 * tests/test-ui.js — v9.6 面板主题 / 可见性 / 无障碍（源码断言 + 覆盖完整性）
 *
 * 怎么跑：
 *   node tests/test-ui.js
 *
 * 为什么是源码断言而不是截图比对：本项目没有 headless 浏览器门禁，
 * 但「暗色漏覆盖一个元素」和「FAB 又变回纯图标」这两类回归是可以静态判定的——
 * 亮色样式里凡是写了白底/深字的选择器，暗色覆盖层里必须有一条对应规则；
 * FAB 必须带可见文字。这些写成断言，回潮立即红。
 */

var fs = require('fs');
var path = require('path');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'bili-subtitle.user.js'), 'utf8');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('[PASS] ' + name); }
  catch (e) { failed++; console.log('[FAIL] ' + name + ' — ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function has(re, msg) { ok(re.test(SRC), msg || ('源码里找不到 ' + re)); }

// 取样式块（buildUI 里的 '<style>' 到 '</style>'）
var styleStart = SRC.indexOf("'<style>'");
var styleEnd = SRC.indexOf("'</style>'");
var STYLE = styleStart >= 0 && styleEnd > styleStart ? SRC.slice(styleStart, styleEnd) : '';

// 暗色覆盖层里出现过的选择器集合
function darkHas(selector) {
  var re = new RegExp('#bsr-root\\[data-theme="dark"\\]\\s+' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
  return re.test(STYLE);
}

test('U0 能取到样式块（否则后面全是假绿）', function () {
  ok(STYLE.length > 1000, '样式块长度异常：' + STYLE.length);
});

// ---------- 主题变量 ----------
test('U1 定义了主题变量，且明暗两套都全', function () {
  var names = ['--bsr-bg', '--bsr-fg', '--bsr-muted', '--bsr-line', '--bsr-soft', '--bsr-input', '--bsr-shadow'];
  ok(/#bsr-root\{--bsr-bg:/.test(STYLE), '浅色变量组要在');
  ok(/#bsr-root\[data-theme="dark"\]\{--bsr-bg:/.test(STYLE), '深色变量组要在');
  names.forEach(function (n) {
    var light = new RegExp('#bsr-root\\{[^}]*' + n.replace(/-/g, '\\-') + ':');
    var dark = new RegExp('#bsr-root\\[data-theme="dark"\\]\\{[^}]*' + n.replace(/-/g, '\\-') + ':');
    ok(light.test(STYLE), '浅色缺变量 ' + n);
    ok(dark.test(STYLE), '深色缺变量 ' + n);
  });
});

// ---------- 暗色覆盖完整性（防「改了亮色忘了同步暗色」） ----------
test('U2 亮色里凡是写死白底的选择器，暗色层必须逐条接管', function () {
  // 这几个是亮色样式里 background:#fff 的（新增白底元素必须同步进本清单与暗色层）
  ['#bsr-panel', '.bsr-credit', '.bsr-tabs'].forEach(function (sel) {
    ok(darkHas(sel), '暗色层缺白底元素 ' + sel + ' 的覆盖');
  });
});

test('U3 亮色里写死深字的选择器，暗色层必须逐条接管', function () {
  ['#bsr-panel', '.bsr-res-t'].forEach(function (sel) {
    ok(darkHas(sel), '暗色层缺深字元素 ' + sel + ' 的覆盖');
  });
});

test('U4 主要交互区在暗色下都要可读（输入/文本域/列表/设置/实时流/进度）', function () {
  ['.bsr-ta', '.bsr-input', '.bsr-sel', '.bsr-res', '.bsr-res-m', '.bsr-setbox', '.bsr-live',
   '.bsr-meta', '.bsr-chunks', '.bsr-bar', '.bsr-title', '.bsr-tab', '.bsr-empty',
   '.bsr-wbox textarea', '.bsr-wpresets button', '#bsr-toast'].forEach(function (sel) {
    ok(darkHas(sel), '暗色层缺 ' + sel);
  });
});

test('U5 暗色层不得把强调色改丢（B 站粉仍是强调色，只是调暗一档）', function () {
  var m = STYLE.match(/#bsr-root\[data-theme="dark"\] \.bsr-h\{[^}]*\}/);
  ok(!!m, '暗色层要覆盖头部');
  ok(/FB7299/.test(m[0]), '头部渐变仍须带品牌粉');
});

// ---------- 入口可见性（铁律：纯图标 = 不存在） ----------
test('U6 FAB 必须带可见文字，不能只有图标', function () {
  var m = SRC.match(/'<button id="bsr-fab"[^']*'/);
  ok(!!m, '要能取到 FAB 的 HTML');
  ok(/<span class="lb">字幕<\/span>/.test(m[0]), 'FAB 里要有「字幕」二字');
  ok(/class="lb"/.test(m[0]), '文字要有独立样式类');
});

test('U7 FAB 是胶囊（有横向内边距），不再是 52px 纯圆点', function () {
  var fabCss = STYLE.match(/#bsr-fab\{[^}]*\}/);
  ok(!!fabCss, '要有 #bsr-fab 样式');
  ok(/padding:0 18px|padding:0 \d+px/.test(fabCss[0]), '要有横向内边距（胶囊形态）');
  ok(!/width:52px/.test(fabCss[0]), '不应再是 52px 定宽圆点');
  ok(/border-radius:23px|border-radius:\d+px/.test(fabCss[0]), '要有胶囊圆角');
});

test('U8 FAB 与主题按钮都有无障碍属性（title / aria-label）', function () {
  ok(/id="bsr-fab"[^']*aria-label="字幕提取"/.test(SRC), 'FAB 要有 aria-label');
  ok(/id="bsr-fab"[^']*title="/.test(SRC), 'FAB 要有 title');
  ok(/id="bsrThemeBtn"[^']*title="/.test(SRC), '主题按钮要有 title');
});

// ---------- 主题切换接线 ----------
test('U9 applyTheme 真的把主题落到 DOM 上（data-theme 属性）', function () {
  ok(/function applyTheme\(\)/.test(SRC), '要有 applyTheme');
  ok(/root\.setAttribute\('data-theme', dark \? 'dark' : 'light'\)/.test(SRC), '必须写 data-theme 属性');
});

test('U10 主题按钮图标随主题变化（不是个摆设）', function () {
  ok(/btn\.textContent = dark \? '☀' : '🌙'/.test(SRC), '按钮文案要随主题切');
  ok(/#bsrThemeBtn'\)\.onclick/.test(SRC), '按钮要有点击处理');
});

test('U11 toggleTheme 切的是显式值并落盘（点了刷新还在）', function () {
  ok(/function toggleTheme\(\)/.test(SRC), '要有 toggleTheme');
  ok(/SETTINGS\.theme = isDarkPreferred\(\) \? 'light' : 'dark'/.test(SRC), '要在明暗之间切');
  ok(/saveSettings\(\)/.test(SRC.match(/function toggleTheme\(\)[^}]*\}/)[0]), '要落盘');
});

test('U12 auto 跟随系统，且系统切换时实时跟随（不只是首次读一次）', function () {
  ok(/prefers-color-scheme: dark/.test(SRC), '要读系统偏好');
  ok(/mq\.addEventListener/.test(SRC) && /mq\.addListener/.test(SRC), '新旧两种监听 API 都要兼容');
  ok(/=== 'auto'\) applyTheme\(\)/.test(SRC), '只有 auto 模式才跟随系统，显式设置不被覆盖');
});

test('U13 主题设置项：读取 / 保存 / 回填 / 三档选项齐全，默认 auto', function () {
  ok(/theme: GM_getValue\('bsr_theme', 'auto'\)/.test(SRC), '默认 auto');
  ok(/GM_setValue\('bsr_theme', SETTINGS\.theme\)/.test(SRC), '要落盘');
  ok(/#bsrTheme'\)\.value = SETTINGS\.theme/.test(SRC), '要回填 UI');
  ok(/SETTINGS\.theme = root\.querySelector\('#bsrTheme'\)\.value/.test(SRC), '保存要读 UI 值');
  ok(/value="auto"/.test(SRC) && /value="light"/.test(SRC) && /value="dark"/.test(SRC), '三档选项都要有');
  ok(/id="bsrTheme"/.test(SRC), '设置面板要有控件');
});

test('U14 建好 UI 立刻落一次主题（避免第一帧闪白）', function () {
  ok(/applyTheme\(\);\s+\/\/ v9\.6/.test(SRC), 'buildUI 内要调一次 applyTheme');
});

test('U15 保存设置后立刻应用主题（不用等下次渲染）', function () {
  var m = SRC.match(/SETTINGS\.theme = root\.querySelector\('#bsrTheme'\)\.value;[\s\S]{0,260}/);
  ok(!!m && /applyTheme\(\)/.test(m[0]), '保存后必须 applyTheme');
});

// ---------- 交互与可读性增强 ----------
test('U16 键盘可达：焦点有可见描边（focus-visible，不全靠鼠标）', function () {
  ok(/focus-visible\{outline:2px solid/.test(STYLE), '要有 focus-visible 描边');
});

test('U17 按钮有 hover / active 反馈（点了有反应）', function () {
  ok(/\.bsr-btn:hover\{filter:brightness/.test(STYLE), '要有 hover');
  ok(/\.bsr-btn:active\{transform:translateY/.test(STYLE), '要有 active');
});

test('U18 面板宽度响应式（窄屏不溢出屏幕）', function () {
  ok(/max-width:calc\(100vw - 32px\)/.test(STYLE), '面板要限制最大宽度');
});

test('U19 长内容区有细滚动条（不是系统默认大方块）', function () {
  ok(/\.bsr-b::-webkit-scrollbar\{width:8px\}/.test(STYLE), '主区滚动条');
  ok(/\.bsr-ta::-webkit-scrollbar/.test(STYLE), '文本域滚动条');
});

test('U20 面板出现有入场动画（不是硬弹出来）', function () {
  ok(/animation:bsrIn/.test(STYLE), '要有入场动画');
  ok(/@keyframes bsrIn/.test(STYLE), '要有 keyframes');
});

// ---------- ----------
console.log('----------------------------------------');
console.log('PASS ' + passed + '/' + (passed + failed));
if (failed > 0) { console.log('FAILED ' + failed + ' 条，以上 [FAIL] 行即详情'); process.exit(1); }
console.log('全部通过，退出码 0');
process.exit(0);
