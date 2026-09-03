// 硅基流动 SenseVoice API 冒烟测试（真实 key 从环境变量 SILICONFLOW_API_KEY 读取，绝不硬编码）
// 用法：SILICONFLOW_API_KEY=sk-xxx node tests/sf-smoke.js [模型]
'use strict';
const fs = require('fs');

// —— 生成 2 秒 16k 单声道 440Hz 正弦 wav（用于冒烟，非语音）——
function makeWav(sec) {
  const sr = 16000, n = sr * sec;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.05, (sec - t) / 0.05); // 防爆音
    const v = 0.4 * env * (Math.sin(2 * Math.PI * 440 * t) * 0.6 + 0.4 * Math.sin(2 * Math.PI * 880 * t));
    data[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(data[i], 44 + i * 2);
  return buf;
}

async function main() {
  const key = process.env.SILICONFLOW_API_KEY || '';
  if (!key) { console.error('✗ 未设置 SILICONFLOW_API_KEY'); process.exit(1); }
  if (key.length < 20) { console.error('✗ key 长度异常，疑似占位符'); process.exit(1); }
  console.log('✓ key 已读取（长度 ' + key.length + '，前4后4：' + key.slice(0, 4) + '…' + key.slice(-4) + '）');

  const model = process.argv[2] || 'FunAudioLLM/SenseVoiceSmall';
  const wav = makeWav(2);
  console.log('→ 测试模型：' + model + '（wav ' + (wav.length / 1024).toFixed(0) + 'KB）');

  const fd = new FormData();
  fd.append('model', model);
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'smoke.wav');
  fd.append('response_format', 'srt');

  const t0 = Date.now();
  const resp = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key },
    body: fd
  });
  const text = await resp.text();
  const ms = Date.now() - t0;
  console.log('→ HTTP ' + resp.status + '（' + ms + 'ms）');
  if (resp.ok) {
    console.log('✓ 鉴权与端点 OK');
    console.log('  返回长度 ' + text.length + '，内容预览：' + (text.slice(0, 120).replace(/\n/g, '\\n') || '(空，纯音调无语音属正常)'));
    // 纯音调通常无语音 → 空/无字幕段；只要 2xx + 非 401/403 即鉴权通
    process.exit(0);
  } else {
    console.log('✗ 失败：' + text.slice(0, 300));
    process.exit(1);
  }
}
main().catch((e) => { console.error('✗ 异常：', e.message); process.exit(1); });
