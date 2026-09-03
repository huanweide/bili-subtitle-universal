// 本地静态服务器：供 agent-browser 灰度测试使用
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = 8765;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json' };

http.createServer(function (req, res) {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/tests/test.html';
  const fp = path.join(root, p);
  fs.readFile(fp, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('http://127.0.0.1:' + PORT + '/tests/test.html');
});
