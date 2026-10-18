// 设置项「只写不读」扫描：统计每个 SETTINGS 键在源码里被读取的次数与位置。
// 只做取证，不改仓库源码。
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', '..', 'bili-subtitle.user.js');
const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const keys = ['aiProvider', 'aiKey', 'aiBase', 'aiAudioEp', 'asrEnable', 'asrFallback', 'asrForce',
  'asrLang', 'asrChunkMin', 'asrModel', 'asrLongMode', 'asrPlayRate', 'translateTo', 'translateModel',
  'hotwordsOn', 'polishOn', 'llmCorrect', 'ytKey', 'searchPlatform', 'customHotwords',
  'autoFetchOnPageSwitch', 'autoFetch', 'exportMode', 'theme', 'hotkeysOn', 'clickSeekOn'];

console.log('KEY'.padEnd(24) + '读次数  读取行号（前 10）');
keys.forEach((k) => {
  const re = new RegExp('SETTINGS\\.' + k + '\\b');
  const hits = [];
  lines.forEach((line, i) => {
    if (!re.test(line)) return;
    if (/GM_setValue|GM_getValue/.test(line)) return;   // 持久化写入行不算「读」
    hits.push(i + 1);
  });
  console.log(k.padEnd(24) + String(hits.length).padStart(4) + '   ' + hits.slice(0, 10).join(','));
});
