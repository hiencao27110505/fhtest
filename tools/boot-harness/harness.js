/* FamilyHub personal-tab boot feedback loop.
   Serves the real built app, swaps vendor/supabase.js for a stub with
   configurable latency + hang injection, seeds the personal DEK in IndexedDB,
   and measures time until the Cá nhân landing tab leaves its loading note.

   Usage: node harness.js [scenario]
     timing  — LAT=300ms per call; RED if time-to-ready > BUDGET
     freeze  — personal_transactions selects never resolve; RED if the tab is
               still stuck (no ready AND no retryable error) after WATCH ms
*/
let puppeteer;
try { puppeteer = require('puppeteer'); }
catch (e) { puppeteer = require('/Users/hiencao/Documents/ClaudeHC/moneylover/node_modules/puppeteer'); }   // borrowed install
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/hiencao/Documents/ClaudeHC/familyhub';
const STUB = path.join(__dirname, 'stub-supabase.js');
const LAT = 300;
const BUDGET = 1500;      // ms: parallel-shaped boot at LAT=300 fits in ~2-3 RTT + parse
const WATCH = 15000;      // ms: a stalled request must surface ready-or-retry within this

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = req.url.split('?')[0];
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const scenario = process.argv[2] || 'timing';
  const srv = await serve();
  const port = srv.address().port;
  const stubJs = fs.readFileSync(STUB, 'utf8');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('vendor/supabase.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: stubJs });
    if (!r.url().startsWith('http://127.0.0.1')) return r.respond({ status: 200, contentType: 'text/plain', body: '' }); // fonts/external: neutralized
    r.continue();
  });
  page.on('console', (m) => { const t = m.text(); if (/error|fail|warn/i.test(t)) console.log('  [console]', t.slice(0, 160)); });

  await page.evaluateOnNewDocument((lat, hang, uid, seedSnap) => {
    localStorage.setItem('fh-resume', '1');
    localStorage.setItem('fh-onboarded', '1');
    localStorage.setItem('fh-lang', 'vi');
    localStorage.setItem('stub-lat', String(lat));
    localStorage.setItem('stub-hang', hang);
    // Seed the personal DEK cache so boot takes the unlocked fast path — and,
    // for the warm scenario, a FHCrypto-format encrypted snapshot beside it.
    (async () => {
      try {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const recs = [{ fid: 'p:' + uid, key, at: Date.now() }];
        if (seedSnap) {
          const txns = []; const today = new Date();
          for (let i = 0; i < 40; i++) {
            const d = new Date(today); d.setDate(d.getDate() - (i % 25));
            const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            txns.push({ id: 'snap-' + i, date: iso, kind: i % 9 === 0 ? 'income' : 'expense', spaceId: null, linkId: null,
              version: 1, updatedAt: null, ts: d.toISOString(), accountId: null, transferGroupId: null, positionId: null,
              qty: null, amt: 40 + i, _unreadable: false, note: 'Snap ' + i, cat: 'Ăn uống', emoji: '🍜', time: null });
          }
          const snap = { v: 1, uid, unreadable: 0, debtsComplete: true, budget: 9000, catBudget: {}, txns, accounts: [], debts: [], memory: [] };
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(snap))));
          const all = new Uint8Array(iv.length + ct.length); all.set(iv); all.set(ct, iv.length);
          let s = ''; for (let i = 0; i < all.length; i++) s += String.fromCharCode(all[i]);
          recs.push({ fid: 'psnap:' + uid, key: btoa(s), at: Date.now() });
        }
        await new Promise((res, rej) => {
          const rq = indexedDB.open('fh-keys', 1);
          rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains('k')) db.createObjectStore('k', { keyPath: 'fid' }); };
          rq.onsuccess = () => {
            const tx = rq.result.transaction('k', 'readwrite');
            for (const r of recs) tx.objectStore('k').put(r);
            tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
          };
          rq.onerror = () => rej(rq.error);
        });
        window.__idbSeeded = true;
      } catch (e) { window.__idbSeedErr = String(e); }
    })();
  }, LAT, ({ freeze: 'from:personal_transactions', 'freeze-early': 'rpc:my_families', warm: 'from:personal_' })[scenario] || '',
     '00000000-0000-4000-8000-000000000001', scenario === 'warm');

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });

  // Poll the personal tab's state until ready / retryable error / timeout.
  let outcome = null, ttr = null;
  const deadline = t0 + (scenario === 'freeze' ? WATCH : 30000);
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const P = window.fhPersonalData ? fhPersonalData() : null;
      const body = document.getElementById('pers-body');
      return { state: P ? P.state : '(no module)', text: body ? body.innerText.slice(0, 80) : '',
               retry: !!(body && body.querySelector('.pers-link')), seeded: !!window.__idbSeeded, seedErr: window.__idbSeedErr || null,
               snap: P ? (P.fromSnapshot || false) : null, uid: P ? P.uid : null };
    });
    if (process.env.DBG && Date.now() - t0 < 3000) console.log('  [poll]', Date.now() - t0, JSON.stringify(s));
    if (s.seedErr) { outcome = 'seed-failed: ' + s.seedErr; break; }
    // Warm success = the ready VIEW is painted (state may sit in 'loading' while
    // the background refresh hangs — the kept view is exactly the point).
    if (scenario === 'warm' && s.text && s.text.indexOf('Đang chuẩn bị') < 0 && s.text.indexOf('Chưa tải') < 0
        && s.text.indexOf('đang khóa') < 0 && s.text.length > 40) { outcome = 'ready'; ttr = Date.now() - t0; break; }
    if (s.state === 'ready') { outcome = 'ready'; ttr = Date.now() - t0; break; }
    if (s.state === 'error' && s.retry) { outcome = 'error-with-retry'; ttr = Date.now() - t0; break; }
    if (s.state === 'locked') { outcome = 'locked(!)'; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!outcome) outcome = 'stuck';

  // Warm: the painted view must also SURVIVE the 12s boot watchdog (it must
  // settle back to ready, never tear down into the error screen).
  if (scenario === 'warm' && outcome === 'ready') {
    await new Promise((r) => setTimeout(r, 13500 - (Date.now() - t0)));
    const s2 = await page.evaluate(() => {
      const body = document.getElementById('pers-body');
      return { state: window.fhPersonalData ? fhPersonalData().state : '?', text: body ? body.innerText.slice(0, 60) : '' };
    });
    if (s2.text.indexOf('Chưa tải') >= 0 || s2.text.indexOf('Đang chuẩn bị') >= 0) outcome = 'view-torn-down-at-watchdog(state=' + s2.state + ')';
    else console.log(`  watchdog survival: view intact at 13.5s (state=${s2.state})`);
  }

  // Latch probe: when stuck, does a manual retry (fhPersonalBoot) do anything?
  let latch = null;
  if (outcome === 'stuck') {
    const before = await page.evaluate(() => (window.__stubLog || []).length);
    await page.evaluate(() => { try { window.fhPersonalBoot && window.fhPersonalBoot(); } catch (e) {} });
    await new Promise((r) => setTimeout(r, LAT * 3));
    const after = await page.evaluate(() => (window.__stubLog || []).length);
    latch = after === before ? 'retry is DEAD (_booting latched)' : `retry issued ${after - before} new calls`;
  }

  const log = await page.evaluate(() => window.__stubLog || []);
  const finalState = await page.evaluate(() => (window.fhPersonalData ? fhPersonalData().state : '(no module)'));

  console.log(`\n== scenario: ${scenario} · LAT=${LAT}ms ==`);
  console.log('waterfall (ms since first stub call):');
  const base = log.length ? log[0].t : 0;
  for (const e of log) console.log(`  ${String(e.t - base).padStart(6)}  ${e.phase.padEnd(5)} ${e.route}`);
  console.log(`outcome: ${outcome}  finalState=${finalState}  ttr=${ttr}ms${latch ? '  · ' + latch : ''}`);

  let verdict;
  if (scenario === 'timing') verdict = (outcome === 'ready' && ttr <= BUDGET) ? 'GREEN' : 'RED';
  else if (scenario === 'warm') verdict = (outcome === 'ready' && ttr <= 2000) ? 'GREEN' : 'RED';   // snapshot must paint despite a fully hung network
  else verdict = (outcome === 'ready' || outcome === 'error-with-retry') ? 'GREEN' : 'RED';
  console.log(`VERDICT: ${verdict}${scenario === 'timing' ? ` (budget ${BUDGET}ms)` : scenario === 'warm' ? ' (snapshot paint ≤2000ms with hung network)' : ` (must surface ready/retry within ${WATCH}ms)`}`);

  await browser.close(); srv.close();
  process.exit(verdict === 'GREEN' ? 0 : 1);
})().catch((e) => { console.error('harness crashed:', e); process.exit(2); });
