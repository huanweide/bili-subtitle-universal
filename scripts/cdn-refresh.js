'use strict';

/**
 * scripts/cdn-refresh.js — push 之后的默认收尾：刷新 jsDelivr CDN 并校验版本。
 *
 * 为什么必须有它（v9.16.0 教训）：
 *   jsDelivr 对 `@main` 这种「分支标签」有 12 小时 s-maxage 缓存（响应头
 *   s-maxage=43200）。刚 push 完新版本，`@main` 链接仍服务旧版——用户去装 /
 *   Tampermonkey 自动更新会拿到旧脚本，表现为「明明 push 了却没更新」。
 *   必须主动 purge 才能立即生效。
 *
 * 用法（在仓库根目录）：
 *   node scripts/cdn-refresh.js
 * 退出码：0 = CDN 已服务到本地 @version；1 = 仍是旧版（改用固定 commit 地址应急）。
 *
 * 发布/更新标准流程（以后默认这么走）：
 *   1. 改代码 → 跑全测试电池 → node --check
 *   2. bump @version（+ README 版本徽章 + CHANGELOG）
 *   3. git commit → git push origin main
 *   4. node scripts/cdn-refresh.js        ← purge + 校验，一步到位
 */

const fs = require('fs');
const path = require('path');

const root = __dirname.endsWith('scripts') ? path.join(__dirname, '..') : __dirname;
const SCRIPT = path.join(root, 'bili-subtitle.user.js');
const REPO = 'huanweide/bili-subtitle-universal';
const MAIN_URL = 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/bili-subtitle.user.js';
const PURGE_URL = 'https://purge.jsdelivr.net/gh/' + REPO + '@main/bili-subtitle.user.js';

function localVersion() {
  const m = fs.readFileSync(SCRIPT, 'utf8').match(/@version\s+([\d.]+)/);
  if (!m) throw new Error('本地脚本没读到 @version');
  return m[1];
}

async function cdnVersion() {
  const res = await fetch(MAIN_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('CDN HTTP ' + res.status);
  const txt = await res.text();
  const m = txt.match(/@version\s+([\d.]+)/);
  return { version: m ? m[1] : '(未读到)', bytes: txt.length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const want = localVersion();
  console.log('本地 @version = ' + want);

  console.log('purge jsDelivr @main ...');
  try {
    const p = await fetch(PURGE_URL, { cache: 'no-store' });
    const j = await p.json().catch(() => null);
    console.log('  purge 状态 = ' + (j && j.status ? j.status : 'HTTP ' + p.status));
  } catch (e) {
    console.log('  purge 请求失败（不影响，缓存最终会自愈）：' + e.message);
  }

  for (let i = 0; i < 6; i++) {
    let got;
    try { got = await cdnVersion(); }
    catch (e) { got = { version: '(抓取失败: ' + e.message + ')' }; }
    if (got.version === want) {
      console.log('✅ CDN 已服务 ' + want + '（' + got.bytes + ' 字节）');
      process.exit(0);
    }
    console.log('  第 ' + (i + 1) + ' 次：CDN=' + got.version + '，等 2s 重试');
    await sleep(2000);
  }
  console.log('⚠️ CDN 仍是旧版。可临时用固定地址：');
  console.log('   https://cdn.jsdelivr.net/gh/' + REPO + '@<commit-sha>/bili-subtitle.user.js');
  process.exit(1);
}

main();
