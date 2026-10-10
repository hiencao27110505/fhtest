/* Locked-statement unlock perf — "the phone heats up opening a sao kê".
   Boots the real built app on the stub (the xlsx code lives in the js-data module,
   so it needs the page), loads an agile-encrypted .xlsx, and times
   window.fhDecryptXlsx (ECMA-376 agile KDF: spinCount × SHA-512 digests, then
   AES-CBC per 4 KB segment) and the full window.fhParseXlsxFile path, each TWICE
   (cold, then warm), reporting wall ms, main-thread task ms (CDP), digests and
   long tasks (fhHeat). A warm run that is no cheaper than the cold one says the
   derived key is not remembered between the unlock preview and the real parse.

   Fixture: tools/fixtures/statements/credit-card.locked.xlsx, password 01011990
   (SYNTHETIC — tools/make-statement-fixtures.py; manifest.json carries the
   password). Any other agile-encrypted file works too:

     node build.js && node tools/boot-harness/statement-perf.js [path.xlsx password]

   WHERE THE WORK IS: 41-xlsx-decrypt runs the whole KDF + AES in a Web Worker
   built from a Blob URL (_xdMath), so the main thread sees almost no task time
   and fhHeat — which wraps the MAIN thread's crypto.subtle only — reads
   `digests: 0` here by design. Wall ms is therefore the number: it is the worker's
   CPU time (spinCount SHA-512 rounds, ~100k for a bank export), which heats the
   phone exactly as much as main-thread work would, just without blocking taps.
   A main-thread fallback (no Worker / Blob) would show up as task ms + digests.

   Headless gotchas as in the README: nothing here needs frames. */
let puppeteer;
try { puppeteer = require('puppeteer'); }
catch (e) { puppeteer = require('/Users/hiencao/Documents/ClaudeHC/moneylover/node_modules/puppeteer'); }
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STUB = path.join(__dirname, 'stub-supabase.js');
const FIX_DIR = path.join(ROOT, 'tools', 'fixtures', 'statements');
let FILE = process.argv[2], PASSWORD = process.argv[3];
if (!FILE) {
  FILE = path.join(FIX_DIR, 'credit-card.locked.xlsx');
  try { PASSWORD = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'manifest.json'), 'utf8')).fixtures.find((f) => f.file === 'credit-card.locked.xlsx').password; } catch (e) { PASSWORD = '01011990'; }
}
if (!fs.existsSync(FILE)) { console.error('no fixture at ' + FILE + ' — run /opt/homebrew/bin/python3 tools/make-statement-fixtures.py, or pass a path and password'); process.exit(2); }
if (!PASSWORD) { console.error('a locked file needs its password: node statement-perf.js <file.xlsx> <password>'); process.exit(2); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.xlsx': 'application/octet-stream' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      if (p === '/__fixture.xlsx') { rsp.writeHead(200, { 'content-type': MIME['.xlsx'] }); fs.createReadStream(FILE).pipe(rsp); return; }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const stubJs = fs.readFileSync(STUB, 'utf8');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('vendor/supabase.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: stubJs });
    if (!r.url().startsWith('http://127.0.0.1')) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
    r.continue();
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('fh-resume', '1'); localStorage.setItem('fh-onboarded', '1');
    localStorage.setItem('fh-lang', 'vi'); localStorage.setItem('stub-lat', '20'); localStorage.setItem('stub-rows', '0');
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.fhDecryptXlsx && window.fhXlsxEncryptionKind && window.fhParseXlsxFile && window.fhHeat, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));   // let boot's own crypto settle so the deltas are the unlock's alone

  const cdp = await page.target().createCDPSession();
  await cdp.send('Performance.enable');
  const M = async () => { const r = await cdp.send('Performance.getMetrics'); const o = {}; r.metrics.forEach((m) => { o[m.name] = m.value; }); return o; };
  const H = () => page.evaluate(() => fhHeat.snapshot());
  const d = (a, b, ha, hb) => ({ task: ((b.TaskDuration - a.TaskDuration) * 1000) | 0, script: ((b.ScriptDuration - a.ScriptDuration) * 1000) | 0,
    digests: hb.digests - ha.digests, decrypts: hb.decrypts - ha.decrypts, importKeys: hb.importKeys - ha.importKeys,
    longTasks: hb.longTasks - ha.longTasks, longTaskMs: Math.round(hb.longTaskMs - ha.longTaskMs) });

  const meta = await page.evaluate(async () => {
    const buf = await (await fetch('/__fixture.xlsx')).arrayBuffer();
    window.__fix = buf;
    let kind = '?'; try { kind = fhXlsxEncryptionKind(buf); } catch (e) { kind = 'err:' + e.message; }
    return { bytes: buf.byteLength, kind };
  });
  console.log(`fixture: ${path.basename(FILE)} · ${meta.bytes} bytes · encryption=${meta.kind}`);
  if (meta.kind !== 'agile') { console.log('not an agile-encrypted workbook; nothing to time'); await browser.close(); srv.close(); process.exit(2); }

  const out = {};
  const run = async (label, fn) => {
    const a = await M(), ha = await H();
    const r = await page.evaluate(fn, PASSWORD);
    out[label] = Object.assign(r, d(a, await M(), ha, await H()));
  };
  const decryptOnly = async (pw) => { const t = performance.now(); let err = null, bytes = 0; try { bytes = (await fhDecryptXlsx(window.__fix, pw)).byteLength; } catch (e) { err = String(e && e.message || e); } return { wallMs: Math.round(performance.now() - t), plainBytes: bytes, err }; };
  const fullParse = async (pw) => { const t = performance.now(); let err = null, rows = -1; try { const f = new File([window.__fix], 'fixture.xlsx'); rows = (await fhParseXlsxFile(f, pw)).rows.length; } catch (e) { err = String(e && e.message || e); } return { wallMs: Math.round(performance.now() - t), rows, err }; };
  const wrongPw = async () => { const t = performance.now(); let err = null; try { await fhDecryptXlsx(window.__fix, 'nope'); } catch (e) { err = String(e && e.message || e); } return { wallMs: Math.round(performance.now() - t), err }; };

  await run('decryptCold', decryptOnly);
  await run('decryptWarm', decryptOnly);
  await run('parseCold', fullParse);
  await run('parseWarm', fullParse);
  await run('wrongPassword', wrongPw);

  console.log(`\n== statement unlock perf ==`);
  for (const k of Object.keys(out)) console.log(k.padEnd(14), JSON.stringify(out[k]));
  const bars = [
    ['statement warm unlock ≤ 50 ms', out.decryptWarm.wallMs <= 50, `${out.decryptWarm.wallMs} ms (cold ${out.decryptCold.wallMs} ms, ${out.decryptCold.digests} digests each — a remembered derived key would make warm ≈ AES only)`],
    ['unlock never blocks the main thread > 50 ms at a stretch', out.decryptCold.longTasks === 0 && out.parseCold.longTasks === 0, `${out.decryptCold.longTasks + out.parseCold.longTasks} long tasks, ${out.decryptCold.longTaskMs + out.parseCold.longTaskMs} ms`],
    ['a wrong password costs one KDF, not two (wall ≤ 1.25 × cold)', out.wrongPassword.err === 'bad_password' && out.wrongPassword.wallMs <= out.decryptCold.wallMs * 1.25 + 20, `${out.wrongPassword.wallMs} ms → ${out.wrongPassword.err}`],
    ['the KDF stays off the main thread (task ≤ 20 ms, 0 main-thread digests)', out.decryptCold.task <= 20 && out.decryptCold.digests === 0, `${out.decryptCold.task} ms task, ${out.decryptCold.digests} digests on the main thread`],
  ];
  console.log('\nbars:');
  for (const [name, ok, detail] of bars) console.log(`  ${ok ? 'GREEN' : 'RED  '}  ${name}  (${detail})`);
  await browser.close(); srv.close();
})().catch((e) => { console.error('statement-perf crashed:', e); process.exit(2); });