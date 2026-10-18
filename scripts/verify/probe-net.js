// 真网络探针：验证 B 站 API 链路是否可达（Node 侧原生 fetch，无浏览器）
// 用途：为 browser-verify 判断「真网 or fixture」提供依据
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function get(url, headers = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', ...headers }, redirect: 'follow' });
    const t = await r.text();
    return { status: r.status, body: t };
  } catch (e) {
    return { status: 0, body: '', err: String(e) };
  }
}

(async () => {
  console.log('=== 1. 主站可达性 ===');
  const home = await get('https://www.bilibili.com/');
  console.log('www.bilibili.com ->', home.status, home.body.length, 'bytes');

  console.log('\n=== 2. WBI nav（拿 img_key/sub_key）===');
  const nav = await get('https://api.bilibili.com/x/web-interface/nav');
  console.log('nav ->', nav.status);
  let wbi = null;
  try {
    const j = JSON.parse(nav.body);
    console.log('nav code =', j.code, 'message =', j.message);
    wbi = j.data?.wbi_img;
    console.log('wbi_img =', JSON.stringify(wbi));
  } catch (e) {
    console.log('nav 非 JSON，前 300 字符:', nav.body.slice(0, 300));
  }

  console.log('\n=== 3. 播放页 API（未经 WBI 签名，看是否 -403/-352）===');
  const BVID = process.argv[2] || 'BV1GJ411x7h7';
  const view = await get('https://api.bilibili.com/x/web-interface/view?bvid=' + BVID);
  console.log('view ->', view.status, view.body.slice(0, 400));
})();
