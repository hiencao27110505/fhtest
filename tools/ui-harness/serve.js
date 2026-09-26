/* Minimal static server for the built app (repo root). Zero deps.
   serve(root) → { port, url, close } bound to 127.0.0.1 on a free port. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
};

function serve(root) {
  root = path.resolve(root || path.join(__dirname, '..', '..'));
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      res({ port, url: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

module.exports = { serve };
