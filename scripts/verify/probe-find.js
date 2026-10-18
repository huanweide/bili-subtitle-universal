// 真网络探针 3：用 B 站搜索（WBI）批量找「真正有字幕轨」的公开视频
const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const mixinKeyOf = o => MIXIN_TAB.map(i => o[i]).join('').slice(0, 32);
function encWbi(params, imgKey, subKey) {
  const mk = mixinKeyOf(imgKey + subKey);
  Object.assign(params, { wts: Math.round(Date.now() / 1000) });
  const q = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return q + '&w_rid=' + md5(q + mk);
}

(async () => {
  const homeR = await fetch('https://www.bilibili.com/', { headers: { 'User-Agent': UA } });
  const cookie = homeR.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const nav = JSON.parse(await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'User-Agent': UA } })).text());
  const imgKey = nav.data.wbi_img.img_url.split('/').pop().replace('.png', '');
  const subKey = nav.data.wbi_img.sub_url.split('/').pop().replace('.png', '');
  const H = { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', Cookie: cookie };
  const jget = async u => { try { return JSON.parse(await (await fetch(u, { headers: H })).text()); } catch (e) { return { code: -1, err: String(e) }; } };

  const KEYWORDS = (process.argv[2] || 'TED 演讲,李永乐,3Blue1Brown,科普 字幕,纪录片').split(',');
  const found = [];
  for (const kw of KEYWORDS) {
    const sq = encWbi({ search_type: 'video', keyword: kw, page: 1 }, imgKey, subKey);
    const s = await jget('https://api.bilibili.com/x/web-interface/wbi/search/type?' + sq);
    const list = s.data?.result || [];
    console.log(`\n### 关键词「${kw}」 search code=${s.code} 结果=${list.length}`);
    for (const it of list.slice(0, 8)) {
      const bvid = it.bvid; if (!bvid) continue;
      const v = await jget('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
      if (v.code !== 0) continue;
      const q = encWbi({ aid: v.data.aid, cid: v.data.cid }, imgKey, subKey);
      const p = await jget('https://api.bilibili.com/x/player/wbi/v2?' + q);
      const subs = p.data?.subtitle?.subtitles || [];
      console.log(`  ${bvid} code=${p.code} subs=${subs.length}  ${(it.title || '').replace(/<[^>]+>/g, '').slice(0, 34)}`);
      if (subs.length) {
        const lan = subs.find(s => /zh|cn/i.test(s.lan)) || subs[0];
        const u = lan.subtitle_url.startsWith('//') ? 'https:' + lan.subtitle_url : lan.subtitle_url;
        const b = await jget(u);
        const n = (b.body || []).length;
        console.log(`     ✔ 字幕 ${n} 条 lan=${lan.lan} 样例=${JSON.stringify((b.body || []).slice(0, 2))}`);
        found.push({ bvid, aid: v.data.aid, cid: v.data.cid, n, title: it.title.replace(/<[^>]+>/g, ''), url: u });
        if (found.length >= 3) break;
      }
    }
    if (found.length >= 3) break;
  }
  console.log('\n===== 汇总 =====');
  console.log(JSON.stringify(found, null, 2));
})();
