// 直接用 playwright-core 驱动本机 Edge 跑灰度页断言（agent-browser 不稳时的备用通道）
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const targets = [
    ['test.html', '灰度 test.html'],
    ['recorder-sim.html', '状态机 recorder-sim.html'],
  ];
  let allOk = true;
  for (const [file, label] of targets) {
    await page.goto('http://127.0.0.1:8765/tests/' + file, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(20000);
    const text = await page.evaluate(() => document.body.innerText);
    console.log('== ' + label + ' ==');
    console.log(text.slice(0, 1400));
    const pass = (text.match(/^\s*PASS/gm) || []).length;
    const fail = (text.match(/^\s*FAIL/gm) || []).length;
    console.log('（按行统计 PASS=' + pass + ' FAIL=' + fail + '）');
    if (fail > 0 || pass === 0) allOk = false;
  }
  await browser.close();
  console.log(allOk ? 'ALL PASS' : 'HAS FAIL');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
