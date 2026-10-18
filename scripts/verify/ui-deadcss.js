// UI 死重审计辅助：抽出 <style> 块里定义的所有 class，与文件其余部分（HTML 字符串 / JS）里
// 实际出现的 class 做比对，列出「定义了但没人用」的死 CSS。只做取证，不改仓库源码。
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', '..', 'bili-subtitle.user.js');
const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

// CSS 块：3783 ~ 3980（'<style>' ~ '</style>'）
const cssStart = 3782, cssEnd = 3979;
const cssText = lines.slice(cssStart, cssEnd + 1).join('\n');
const restOfFile = lines.filter((_, i) => i < cssStart || i > cssEnd).join('\n');

const classes = new Set();
const re = /\.([A-Za-z][\w-]*)/g;
let m;
while ((m = re.exec(cssText))) classes.add(m[1]);

const dead = [];
const used = [];
[...classes].sort().forEach((c) => {
  // 在 CSS 之外的地方，是否以 class="... c ..." / classList.*('c') / querySelector('.c') / class="c" 形式出现
  const patterns = [
    new RegExp('class="' + '[^\']*\\b' + c + '\\b' + '[^\']*"'),
    new RegExp("classList\\.[a-zA-Z]+\\(\\s*'[^']*\\b" + c + "\\b"),
    new RegExp("'[.]" + c + "\\b"),
    new RegExp('"[.]' + c + '\\b'),
    new RegExp("closest\\(\\s*'[.]" + c + "'"),
    new RegExp("querySelectorAll?\\(\\s*'[^\']*[.]" + c + "\\b"),
  ];
  const hit = patterns.some((p) => p.test(restOfFile));
  (hit ? used : dead).push(c);
});

console.log('CSS 中出现的 class 总数：' + classes.size);
console.log('\n=== 疑似死 CSS（CSS 有定义，文件其余部分无引用）===');
dead.forEach((c) => console.log('  .' + c));
console.log('\n（以下为确认有引用，供交叉核对）');
used.forEach((c) => console.log('  .' + c));
