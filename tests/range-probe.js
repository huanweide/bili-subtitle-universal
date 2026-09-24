// tests/range-probe.js —— v9.0 前置验证：B站音频 CDN 支持不支持「分段下载 + 分段独立解码」
// 用法：node tests/range-probe.js [bvid] [page]
// 验证三件事：
//   ① Range 请求是否返回 206（不支持的话，v9.0 分段解码直接判死刑）
//   ② 文件 box 结构：moov 在文件头还是尾、有没有 moof/sidx 分片索引
//   ③ 分片边界能否按 box 精确定位（决定能不能只下载某一段）
'use strict';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

function api(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/' } })
    .then((r) => r.text()).then(JSON.parse);
}

// 解析 sidx（分片索引）：一次拿到全部分片的大小与时长，不用逐片试探
function parseSidx(buf, off) {
  const version = buf.readUInt8(off + 8);
  let p = off + 12;                        // 跳过 size(4)+type(4)+version(1)+flags(3)
  p += 4;                                  // reference_ID
  const timescale = buf.readUInt32BE(p); p += 4;
  let earliest = 0;
  if (version === 0) { earliest = buf.readUInt32BE(p); p += 4; } else { earliest = Number(buf.readBigUInt64BE(p)); p += 8; }
  let firstOffset = 0;
  if (version === 0) { firstOffset = buf.readUInt32BE(p); p += 4; } else { firstOffset = Number(buf.readBigUInt64BE(p)); p += 8; }
  p += 2;                                  // reserved
  const count = buf.readUInt16BE(p); p += 2;
  const list = [];
  let t = earliest;
  for (let i = 0; i < count; i++) {
    const w1 = buf.readUInt32BE(p); p += 4;
    const dur = buf.readUInt32BE(p); p += 4;
    p += 4;                                // SAP 信息
    list.push({ size: w1 & 0x7fffffff, startSec: t / timescale, durSec: dur / timescale, isIdx: (w1 >>> 31) === 1 });
    t += dur;
  }
  return { timescale, count, list, totalSec: t / timescale };
}

function parseBoxes(buf, depth, limit) {
  const out = [];
  let p = 0;
  while (p + 8 <= buf.length && out.length < limit) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    let head = 8;
    if (size === 1 && p + 16 <= buf.length) { size = Number(buf.readBigUInt64BE(p + 8)); head = 16; }
    if (size === 0) size = buf.length - p;
    if (size < 8 || p + size > buf.length) { out.push({ off: p, type: type + '(越界,size=' + size + ')', size }); break; }
    out.push({ off: p, type, size, head });
    p += size;
  }
  return out;
}

(async () => {
  const bvid = process.argv[2] || 'BV1424U6JEGL';
  const page = Number(process.argv[3] || 1);
  const v = await api('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
  if (v.code !== 0) throw new Error('view 失败 code=' + v.code);
  const pg = v.data.pages[page - 1];
  console.log('视频：' + v.data.title.slice(0, 30) + ' 共 ' + v.data.pages.length + ' P');
  console.log('第 ' + page + ' P：' + (pg.part || '') + ' cid=' + pg.cid + ' 时长=' + pg.duration + 's');

  const p = await api('https://api.bilibili.com/x/player/playurl?bvid=' + bvid + '&cid=' + pg.cid + '&fnval=16&fnver=0&fourk=1');
  if (p.code !== 0 || !p.data.dash) throw new Error('playurl 失败 code=' + p.code);
  const audio = p.data.dash.audio.slice().sort((a, b) => a.bandwidth - b.bandwidth)[0];
  const url = audio.baseUrl.replace(/^http:/, 'https:');
  console.log('音频流：id=' + audio.id + ' 码率=' + Math.round(audio.bandwidth / 1000) + 'kbps 编码=' + audio.codecs + ' mime=' + audio.mimeType);

  // ① Range 支持探测
  const r1 = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', 'Range': 'bytes=0-1023' } });
  const cr = r1.headers.get('content-range');
  const ar = r1.headers.get('accept-ranges');
  const total = cr ? Number(cr.split('/')[1]) : 0;
  console.log('\n【① Range 支持】HTTP ' + r1.status + (r1.status === 206 ? ' 部分内容（支持分段下载）' : ' 完整内容（不支持分段）'));
  console.log('   Content-Range: ' + cr + '   Accept-Ranges: ' + ar);
  console.log('   文件总大小：' + (total / 1024 / 1024).toFixed(2) + 'MB   CORS 暴露头：' + (r1.headers.get('access-control-expose-headers') || '无'));
  if (r1.status !== 206) { console.log('\n结论：不支持 Range，v9.0 分段解码方案不可行。'); return; }

  // ② 读文件尾部 256KB，看 moov 是不是在末尾
  const tailStart = Math.max(0, total - 262144);
  const r2 = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', 'Range': 'bytes=' + tailStart + '-' + (total - 1) } });
  const tail = Buffer.from(await r2.arrayBuffer());

  // ③ 读文件头部 256KB，解析 box 结构
  const r3 = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', 'Range': 'bytes=0-262143' } });
  const head = Buffer.from(await r3.arrayBuffer());
  const boxes = parseBoxes(head, 0, 40);
  console.log('\n【② 头部 box 结构】（前 256KB）');
  boxes.slice(0, 12).forEach((b) => console.log('   +' + String(b.off).padStart(8) + '  ' + b.type.padEnd(6) + '  ' + b.size + ' 字节'));
  const hasMoof = boxes.some((b) => b.type === 'moof');
  const hasMoov = boxes.some((b) => b.type === 'moov');
  const headMoovLen = (boxes.find((b) => b.type === 'moov') || {}).size || 0;
  const moovEnd = boxes.find((b) => b.type === 'moov') ? boxes.find((b) => b.type === 'moov').off + headMoovLen : 0;
  console.log('   moov（说明书）在文件头内：' + (hasMoov ? '是，结束于第 ' + moovEnd + ' 字节' : '否'));
  console.log('   头部已见 moof（媒体分片）：' + (hasMoof ? '是' : '否'));

  // 分片数量估算
  const moofs = boxes.filter((b) => b.type === 'moof').length;
  console.log('\n【③ 分片边界】');
  if (moofs > 0) {
    const firstMoof = boxes.find((b) => b.type === 'moof');
    const secondMoof = boxes.filter((b) => b.type === 'moof')[1];
    const pieceBytes = secondMoof ? secondMoof.off - firstMoof.off : 0;
    console.log('   首片 moof 起点：' + firstMoof.off + ' 字节');
    console.log('   单片体积：约 ' + pieceBytes + ' 字节');
    console.log('   按此推算整段分片数：约 ' + (pieceBytes ? Math.ceil((total - moovEnd) / pieceBytes) : '?') + ' 片');
    console.log('   独立解码所需：init（0 到 ' + moovEnd + '）+ 任意一片（moof+mdat）');
  } else {
    console.log('   头 256KB 内没看到 moof，可能在文件后段或用了别的分片形态');
  }

  // ④ 解析 sidx 拿完整分片表
  const sidxBox = boxes.find((b) => b.type === 'sidx');
  if (sidxBox) {
    const sidx = parseSidx(head, sidxBox.off);
    console.log('\n【④ 分片索引 sidx】');
    console.log('   timescale=' + sidx.timescale + '  分片数=' + sidx.count + '  索引覆盖时长=' + sidx.totalSec.toFixed(1) + 's');
    const first3 = sidx.list.slice(0, 3).map((s) => s.size + 'B/' + s.durSec.toFixed(2) + 's').join('  ');
    console.log('   前 3 片：' + first3);
    console.log('   单片平均时长：' + (sidx.totalSec / sidx.count).toFixed(2) + 's，单片平均体积：' + Math.round(sidx.list.reduce((a, b) => a + b.size, 0) / sidx.count) + 'B');
    const scale = total / ((sidx.list.reduce((a, b) => a + b.size, 0)) || 1);
    console.log('   若整段 ' + (total / 1024 / 1024).toFixed(1) + 'MB，推算分片总数约 ' + Math.round(sidx.count * scale) + ' 片');
    console.log('   ★ 分段解码方案：init(0-' + (sidxBox.off + sidxBox.size) + 'B) + 任意一片 → 独立解码成 ' + (sidx.totalSec / sidx.count).toFixed(2) + 's 音频，内存恒定');
  } else {
    console.log('\n【④ 分片索引】头部没找到 sidx（可能只在文件尾部）');
  }

  console.log('\n【结论】' + (r1.status === 206 && headMoovLen > 0
    ? 'Range 支持 + init 段可定位 → v9.0 分段解码方案可行'
    : '需要进一步确认，见上面各项'));
})().catch((e) => { console.error('探测失败：' + e.message); process.exit(1); });
