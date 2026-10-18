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
  // 两个坑，都是实测出来的：
  //  1. 必须带 cache-busting 查询串——否则可能落到另一个没被 purge 到的边缘节点，
  //     读出来是旧版，但真实用户（浏览器/curl）拿到的是新版，脚本会误报"没更新"。
  //  2. 必须带浏览器 UA——node fetch 的默认头会被 jsDelivr 归到另一类缓存，
  //     曾出现「node 读到 229628 字节旧版 / curl 读到 264127 字节新版」的分叉。
  const res = await fetch(MAIN_URL + '?t=' + Date.now(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Cache-Control': 'no-cache'
    }
  });
  if (!res.ok) throw new Error('CDN HTTP ' + res.status);
  // 注意：别拿 txt.length 当字节数报。JS 字符串按 UTF-16 单位计长，而磁盘/HTTP 的字节是 UTF-8；
  // 本脚本中文注释很多，两者能差出 3 万多（264127 UTF-8 字节 vs 229962 UTF-16 单位），
  // 之前就是被这个差值误导，白查了半天以为是 CDN 返回了不同项目。
  const txt = await res.text();
  const bytes = Buffer.byteLength(txt, 'utf8');
  const m = txt.match(/@version\s+([\d.]+)/);
  return { version: m ? m[1] : '(未读到)', bytes: bytes, text: txt };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const want = localVersion();
  console.log('本地 @version = ' + want);

  // ⚠️ purge 有速率限制（短时多次 purge 会被 throttled: true），而且接口照样返回 200/finished
  //    ——不看 throttled 字段会以为「刷新成功但就是不更新」，白查一整天。且不要明知被限流还重试，
  //    那只会把限制窗口拖得更长。遇到限流就如实报错并提示改用固定 commit 地址。
  console.log('purge jsDelivr @main ...');
  let throttled = false;
  try {
    const p = await fetch(PURGE_URL, { cache: 'no-store' });
    const j = await p.json().catch(() => null);
    const info = j && j.paths && j.paths['/gh/' + REPO + '@main/bili-subtitle.user.js'];
    if (info && info.throttled) {
      throttled = true;
      console.log('  ⚠️ purge 被 jsDelivr 限流（重置约 ' + info.throttlingReset + ' 秒）。'
        + '接口仍返回 finished，但实际不会刷新——别再连点 purge，只会拖长限制。');
      console.log('  现在要立刻用新版，请装固定 commit 地址（不受缓存/限流影响）。');
      process.exit(1);
    }
    console.log('  purge 状态 = ' + (j && j.status ? j.status : 'HTTP ' + p.status));
  } catch (e) {
    console.log('  purge 请求失败（不影响，缓存最终会自愈）：' + e.message);
  }

  // purge 不是瞬间广播到所有边缘节点的：实测会出现「curl 已拿到新版、
  // 这条请求却仍从 cache-fra/itm 某节点返回旧版」的情况。所以要轮询等一等，
  // 但只要哪次一致就立刻收工（通常几秒内就一致），不会干等到超时。
  const MAX_TRY = 15, WAIT_MS = 8000;
  for (let i = 0; i < MAX_TRY; i++) {
    let got;
    try { got = await cdnVersion(); }
    catch (e) { got = { version: '(抓取失败: ' + e.message + ')' }; }
    if (got.version === want) {
      console.log('✅ CDN 已服务 ' + want + '（' + got.bytes + ' 字节 UTF-8）');
      process.exit(0);
    }
    console.log('  第 ' + (i + 1) + '/' + MAX_TRY + ' 次：CDN=' + got.version + '，等 ' + (WAIT_MS / 1000) + 's');
    await sleep(WAIT_MS);
  }
  console.log('⚠️ purge 已提交，但仍有边缘节点返回旧版（' + want + ' 尚未全网生效）。');
  console.log('   这通常几分钟内自行收敛，不是脚本坏了。要立刻拿到新版请用固定 commit 地址：');
  console.log('   https://cdn.jsdelivr.net/gh/' + REPO + '@<commit-sha>/bili-subtitle.user.js');
  process.exit(1);
}

main();
