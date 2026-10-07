'use strict';
// 文档一致性门禁：README 里的版本号与测试数必须和真实源码对得上。
// 背景：v9.0.0 的 README 同时出现「54 项」「69 项」「75/75」三个互不相符的数字，
// 全是手工改漏的。这里把它们钉死成一处事实源，漂移即红。
// 运行：node tests/check-docs.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const src = read('bili-subtitle.user.js');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const testsSrc = read('tests/run-tests.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

// —— 事实源 ——
const scriptVer = (src.match(/@version\s+(\S+)/) || [])[1];
const realTests = (testsSrc.match(/^test\(/gm) || []).length;
const changelogVer = (changelog.match(/^##\s+([0-9][0-9.]*)/m) || [])[1];
const badgeVer = (readme.match(/badge\/version-([0-9][0-9.]*)-/) || [])[1];
const badgeTests = (readme.match(/badge\/tests-(\d+)%2F(\d+)-/) || []).slice(1);

console.log('== 文档一致性 ==');
check('userscript @version 与 README 版本徽章一致', () => {
  if (!scriptVer || !badgeVer) throw new Error('取不到版本号：脚本=' + scriptVer + ' 徽章=' + badgeVer);
  if (scriptVer !== badgeVer) throw new Error('脚本 ' + scriptVer + ' ≠ README 徽章 ' + badgeVer);
});
check('userscript @version 与 CHANGELOG 最新条目一致', () => {
  if (scriptVer !== changelogVer) throw new Error('脚本 ' + scriptVer + ' ≠ CHANGELOG ' + changelogVer);
});
check('README 测试徽章数 = 真实用例数', () => {
  if (realTests === 0) throw new Error('没数到任何用例');
  if (badgeTests[0] !== String(realTests) || badgeTests[1] !== String(realTests)) {
    throw new Error('徽章 ' + badgeTests.join('/') + ' ≠ 真实 ' + realTests + '/' + realTests);
  }
});
check('README 正文里散落的「N 项」也必须与真实用例数一致', () => {
  const nums = (readme.match(/(\d+)\s*项(?:Node\s*)?单元测试|（(\d+)\s*项）/g) || [])
    .map((s) => (s.match(/(\d+)/) || [])[1]);
  const bad = nums.filter((n) => n !== String(realTests));
  if (bad.length) throw new Error('README 出现过期数字 ' + bad.join('、') + '，应为 ' + realTests);
});
check('README 里不存在 0 项/空的测试描述', () => {
  if (/0\s*项单元测试/.test(readme)) throw new Error('README 出现 0 项单元测试');
});

console.log('\n结果：' + (failed ? failed + ' 处不一致' : '全部一致（版本 ' + scriptVer + ' · 用例 ' + realTests + '）'));
process.exit(failed ? 1 : 0);
