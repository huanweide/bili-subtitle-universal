// 真网络探针 2：WBI 签名 + 找一个有官方字幕的公开视频
const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIXIN_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function getMixinKey(orig) {
  return MIXIN_TAB.map(i => orig[i]).join('').slice(0, 32);
}
function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const currTime = Math.round(Date.now() / 1000);
  const chrFilter = /[!'()*]/g;
  Object.assign(params, { wts: currTime });
  const query = Object.keys(params).sort().map(k => {
    const v = String(params[k]).replace(chrFilter, '');
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }).join('&');
  return query + '&w_rid=' + md5(query + mixinKey);
}

async function get(url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', 'Origin': 'https://www.bilibili.com', ...headers } });
    return { status: r.status, body: await r.text() };
  } catch (e) { return { status: 0, body: '', err: String(e) }; }
}

const CANDIDATES = (process.argv[2] || 'BV1GJ411x7h7,BV1ys411472E,BV1Y4411Q7EQ,BV1GJ411x7h7').split(',');

(async () => {
  const nav = JSON.parse((await get('https://api.bilibili.com/x/web-interface/nav')).body);
  const imgKey = nav.data.wbi_img.img_url.split('/').pop().replace('.png', '');
  const subKey = nav.data.wbi_img.sub_url.split('/').pop().replace('.png', '');
  // 拿 bilibili cookie（buvid3 等）
  const homeR = await fetch('https://www.bilibili.com/', { headers: { 'User-Agent': UA } });
  const cookie = (homeR.headers.getSetCookie ? homeR.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  console.log('cookie =', cookie.slice(0, 160));
  console.log('imgKey =', imgKey, 'subKey =', subKey, '\n');

  for (const bvid of CANDIDATES) {
    const v = JSON.parse((await get('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { Cookie: cookie })).body);
    if (v.code !== 0) { console.log(bvid, 'view 失败', v.code, v.message); continue; }
    const aid = v.data.aid, cid = v.data.cid;
    const q = encWbi({ aid, cid }, imgKey, subKey);
    const p = JSON.parse((await get('https://api.bilibili.com/x/player/wbi/v2?' + q, { Cookie: cookie })).body);
    console.log('---', bvid, '|', (v.data.title || '').slice(0, 30));
    console.log('   player/v2 code =', p.code, p.message);
    if (p.code === 0) {
      const subs = p.data?.subtitle?.subtitles || [];
      console.log('   字幕轨数 =', subs.length, JSON.stringify(subs.map(s => ({ lan: s.lan, doc: s.lan_doc }))));
      if (subs.length) {
        const u = subs[0].subtitle_url.startsWith('//') ? 'https:' + subs[0].subtitle_url : subs[0].subtitle_url;
        const b = JSON.parse((await get(u, { Cookie: cookie })).body);
        console.log('   字幕 body 条数 =', (b.body || []).length);
        console.log('   前 2 条 =', JSON.stringify((b.body || []).slice(0, 2)));
        console.log('   >>> 命中可用视频:', bvid);
        break;
      }
    } else {
      console.log('   ', p.body?.slice(0, 120));
    }
  }
})();
