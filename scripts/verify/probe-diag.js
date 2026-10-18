// 诊断：把 player/wbi/v2 的 subtitle 字段原样打出来，判断是否「未登录导致字幕为空」
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
  const H = { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/video/BV1u44y1H7ZK', Cookie: cookie };
  const jget = async u => JSON.parse(await (await fetch(u, { headers: H })).text());

  for (const bvid of ['BV1u44y1H7ZK', 'BV1ZV411a7Fc']) {
    const v = await jget('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
    console.log('view code', v.code, 'up=', v.data?.owner?.name, 'title=', v.data?.title);
    const q = encWbi({ aid: v.data.aid, cid: v.data.cid }, imgKey, subKey);
    const p = await jget('https://api.bilibili.com/x/player/wbi/v2?' + q);
    console.log('  player code', p.code, 'message', p.message);
    console.log('  subtitle =', JSON.stringify(p.data?.subtitle));
    console.log('  need_login_subtitle =', p.data?.need_login_subtitle, '| asr_language =', JSON.stringify(p.data?.asr_language));
  }
})();
