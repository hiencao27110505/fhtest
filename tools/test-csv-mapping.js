#!/usr/bin/env node
// Local test for api/csv-column-mapping.js — no Vercel account, no `vercel dev`, no
// deployed project needed. Reads GEMINI_API_KEY from .env.local (gitignored) and calls
// the handler function directly with a mock req/res.
//
// Setup: cp .env.local.example .env.local, then fill in a key from aistudio.google.com
// Usage: node tools/test-csv-mapping.js

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error(`Missing ${envPath}\n\nCreate it first:\n  cp .env.local.example .env.local\n  # then edit in your real key`);
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

loadEnvLocal();

const handler = require('../api/csv-column-mapping.js');

// Real rows from the messy shared-expenses sample this pipeline was validated against —
// mixed date formats (dd/mm/yyyy, ISO, "Jul 9 2026"...) is exactly what should trigger
// the Stage 3 fallback. This is a trimmed slice; the full file has 8 distinct formats.
const headers = ['Ngày', 'Nội dung', 'Loại', 'Số tiền', 'Ai trả', 'Chia với', 'Ghi chú'];
const sampleRows = [
  ['01/07/2026', 'Tiền nhà tháng 7', 'nhà cửa', '8.000.000', 'Trang', 'Trang/Hiển', ''],
  ['2026-07-02', 'internet + tivi', 'Nha cua', '299000', 'Hiển', '', 'FPT'],
  ['3/7', 'đi chợ', 'Ăn Uống', '650.000 đ', 'trang', 'ca hai', ''],
  ['05-07-26', 'grab sân bay', 'di chuyen', '320000', '', '', 'quên ghi ai trả'],
  ['Jul 9 2026', 'CGV xem phim', 'giải trí', '240000', 'Hiển', 'Trang;Hiển', ''],
  ['2026-07-10', 'Netflix', 'giai tri', '6.99', 'Trang', 'Trang/Hiển', 'USD - thẻ visa'],
];

const req = { method: 'POST', body: { headers, sampleRows } };
const res = {
  status(code) {
    this._status = code;
    return this;
  },
  json(payload) {
    console.log(`HTTP ${this._status}\n`);
    console.log(JSON.stringify(payload, null, 2));
  },
};

handler(req, res).catch((e) => {
  console.error('Handler threw:', e);
  process.exit(1);
});
