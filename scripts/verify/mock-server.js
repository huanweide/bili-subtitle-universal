// 本地假服务：原样记录 request line / headers / body，用于核对脚本实际发出的请求形态。
// 只用于审计取证，不修改仓库源码。
const http = require('http');

const LOG = [];
const OUT = process.env.MOCK_OUT || __dirname + '/shots/mock-requests.log';

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const entry = {
      method: req.method,
      url: req.url,
      httpVersion: req.httpVersion,
      headers: req.headers,
      bodyLength: body.length,
      bodyPreview: body.toString('utf8').slice(0, 1200),
    };
    LOG.push(entry);
    process.stdout.write(
      '\n=== REQ ===\n' + req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\n' +
      Object.keys(req.headers).map((k) => k + ': ' + req.headers[k]).join('\n') + '\n' +
      '--- body (' + body.length + ' bytes) ---\n' + entry.bodyPreview + '\n'
    );
    // 默认返回带 text 的 JSON（模拟 SiliconFlow / 自定义端点最常见的响应形态）
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'MOCK: 这是一段假转写结果。第二句。' }));
  });
});

process.on('SIGINT', () => { require('fs').writeFileSync(OUT, JSON.stringify(LOG, null, 2)); process.exit(0); });

server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => {
  process.stdout.write('mock server on http://127.0.0.1:' + (process.env.PORT || 8787) + '\n');
  process.stdout.write('OUT=' + OUT + '\n');
});
