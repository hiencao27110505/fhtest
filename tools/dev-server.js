#!/usr/bin/env node
// Local dev server with /api/*.js route parity -- the one thing
// `python3 -m http.server` can't do, since it only serves static files and
// has no concept of a Vercel serverless function. Zero dependencies, matching
// this repo's existing setup.
//
// Usage: node tools/dev-server.js [port]   (default 8934)
// Reads GEMINI_API_KEY from .env.local, same as tools/test-csv-mapping.js.

const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const apiFile = path.join(ROOT, 'api', url.pathname.slice('/api/'.length) + '.js');
    if (!fs.existsSync(apiFile)) { res.writeHead(404); res.end('not found'); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
      req.method = 'POST';
      const fakeRes = {
        status(code) { res.statusCode = code; return this; },
        json(payload) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); },
      };
      try {
        delete require.cache[require.resolve(apiFile)]; // pick up edits without restarting
        await require(apiFile)(req, fakeRes);
      } catch (e) {
        res.statusCode = 500; res.end('dev-server error: ' + (e && e.message || e));
      }
    });
    return;
  }

  let filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(ROOT, 'index.html');
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

const port = Number(process.argv[2]) || 8934;
server.listen(port, () => console.log('Dev server (with /api parity) on http://localhost:' + port));
