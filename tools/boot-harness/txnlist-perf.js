/* Giao dịch screen (#txn-overlay) perf loop — "the phone heats up on the list".
   Boots the real built app on the stub (same as harness.js), injects N decrypted
   personal rows straight into fhPersonalData() (a realistic mix: expenses with
   tree nodes, transfer pairs, income, loans), opens the personal list and
   measures, via CDP Performance metrics:
     open    — openTxns('personal') wall time + DOM size
     type    — five search keystrokes (onTxnQ per char)
     filter  — a Loại chip toggle off/on
     idle    — 4s with the overlay open and nothing touched (continuous work)
     scroll  — 2s of programmatic scrolling through the list
   Usage: node build.js && node tools/boot-harness/txnlist-perf.js [rows=1500] */
let puppeteer;
try { puppeteer = require('puppeteer'); }
catch (e) { puppeteer = require('/Users/hiencao/Documents/ClaudeHC/moneylover/node_modules/puppeteer'); }
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STUB = path.join(__dirname, 'stub-supabase.js');
const ROWS = Number(process.argv[2] || 1500);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
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
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
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
    (async () => {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await new Promise((res) => {
        const rq = indexedDB.open('fh-keys', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('k', { keyPath: 'fid' });
        rq.onsuccess = () => { const tx = rq.result.transaction('k', 'readwrite'); tx.objectStore('k').put({ fid: 'p:00000000-0000-4000-8000-000000000001', key, at: Date.now() }); tx.oncomplete = res; };
      });
    })();
  });
  if (process.env.STEP) console.log('step:', 'await page.goto(');
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  if (process.env.STEP) console.log('step:', 'try { await page.waitForFuncti');
  try { await page.waitForFunction(() => window.fhPersonalData && fhPersonalData().key && fhPersonalData().uid, { timeout: 30000 }); }
  catch (e) { console.log('not ready:', await page.evaluate(() => JSON.stringify({ st: window.fhPersonalData && fhPersonalData().state, body: (document.getElementById('pers-body') || {}).innerText }))); throw e; }

  if (process.env.STEP) console.log('step:', "// The stub's personal_labels");
  // The stub's personal_labels insert "succeeds" but reads back empty, so the
  // label seeder re-hydrates forever (a stub artifact — prod seeds once). Stop it,
  // and stop hydrate from overwriting the injected ledger.
  await page.evaluate(() => { window.fhPersonalLabelsEnsureDefaults = async () => false; window.fhPersonalHydrate = async () => {}; });
  await new Promise((r) => setTimeout(r, 1500));
  if (process.env.STEP) console.log('step:', '// Inject the decrypted ledger');
  // Inject the decrypted ledger.
  await page.evaluate((n) => {
    const P = fhPersonalData(); const today = new Date();
    const nodes = (window.FH_TAX ? FH_TAX.nodes.filter((x) => x.kind === 'expense' && x.depth >= 2).map((x) => x.code) : []).slice(0, 60);
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const payees = ['Highlands Coffee', 'GrabFood', 'Nguyễn Văn A', 'Circle K', 'Shopee', 'Bách Hoá Xanh', 'Trần Thị B', 'Be', 'Phúc Long', 'Winmart'];
    P.accounts = [{ id: 'acc-vib', name: 'VIB' }, { id: 'acc-vcb', name: 'VCB' }, { id: 'acc-momo', name: 'MoMo' }];
    const txs = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(today); d.setDate(d.getDate() - Math.floor(i / 8));
      const base = { id: 'tx-' + i, date: iso(d), time: String(8 + (i % 12)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'),
        spaceId: null, linkId: null, accountId: ['acc-vib', 'acc-vcb', 'acc-momo'][i % 3], src: i % 4 ? 'email' : null, _unreadable: false };
      if (i % 40 === 5) { txs.push(Object.assign(base, { kind: 'transfer', amt: -500, transferGroupId: 'g' + i, accountId: 'acc-vib' }));
                          txs.push(Object.assign({}, base, { id: 'tx-' + i + 'b', kind: 'transfer', amt: 500, transferGroupId: 'g' + i, accountId: 'acc-vcb' })); continue; }
      if (i % 25 === 3) { txs.push(Object.assign(base, { kind: 'income', amt: 15000, note: 'Lương', cat: 'Lương', emoji: '💰' })); continue; }
      txs.push(Object.assign(base, { kind: 'expense', amt: 20 + (i % 300), note: payees[i % payees.length] + ' ' + i, cat: 'Khác',
        emoji: '🍜', who: payees[i % payees.length], node: nodes.length ? nodes[i % nodes.length] : null }));
    }
    P.txns = txs.filter((t) => t.date >= iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
    P.txnsOld = txs.filter((t) => t.date < iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
    window.fhPersonalOlder = { state: 'done' };
  }, ROWS);

  await page.evaluate(() => { const o = window.fhPersonalHydrate; if (o) window.fhPersonalHydrate = function () { (window.__hydCalls = window.__hydCalls || []).push((new Error().stack || '').split('\n').slice(2, 5).map((x) => x.trim().replace(/http:\/\/[^/]+\//, '')).join(' < ')); return o.apply(this, arguments); }; });
  const cdp = await page.target().createCDPSession();
  await cdp.send('Performance.enable');
  const M = async () => { const r = await cdp.send('Performance.getMetrics'); const o = {}; r.metrics.forEach((m) => { o[m.name] = m.value; }); return o; };
  const d = (a, b) => ({ task: ((b.TaskDuration - a.TaskDuration) * 1000) | 0, script: ((b.ScriptDuration - a.ScriptDuration) * 1000) | 0,
    layout: ((b.LayoutDuration - a.LayoutDuration) * 1000) | 0, style: ((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000) | 0,
    layouts: b.LayoutCount - a.LayoutCount, styles: b.RecalcStyleCount - a.RecalcStyleCount, nodes: b.Nodes });
  const out = {};

  if (process.env.STEP) console.log('step:', 'let a = await M();');
  let a = await M();
  const openMs = await page.evaluate(() => { const t = performance.now(); openTxns('personal'); document.body.offsetHeight; return performance.now() - t; });
  await new Promise((r) => setTimeout(r, 600));
  out.open = Object.assign({ wallMs: Math.round(openMs) }, d(a, await M()), await page.evaluate(() => ({ listRows: document.querySelectorAll('#txn-list .row').length, listNodes: document.querySelectorAll('#txn-list *').length })));

  if (process.env.STEP) console.log('step:', 'a = await M();\n  const typeMs');
  a = await M();
  const typeMs = await page.evaluate(() => { const q = document.getElementById('txn-q'); const ts = []; for (const c of 'coffe') { q.value += c; const t = performance.now(); renderTxnScreen(); document.body.offsetHeight; ts.push(Math.round(performance.now() - t)); } q.value = ''; renderTxnScreen(); return ts; });
  out.type = Object.assign({ perKeyMs: typeMs }, d(a, await M()));

  if (process.env.STEP) { console.log('step: filter probe');
    await page.evaluate(() => { window.__fp = []; const o = window.renderTxnScreen; window.renderTxnScreen = function () { window.__fp.push('render>'); o(); window.__fp.push('<render'); };
      const ok = window.txnSheetKind; window.txnSheetKind = function () { window.__fp.push('sheet>'); ok(); window.__fp.push('<sheet'); };
      setTimeout(() => { txnFiltTap('kinds', 'thu'); document.body.offsetHeight; window.__fp.push('t1'); txnFiltTap('kinds', 'thu'); document.body.offsetHeight; window.__fp.push('done'); }, 0); });
    for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 1000)); console.log('probe', JSON.stringify(await Promise.race([page.evaluate(() => window.__fp), new Promise((r) => setTimeout(() => r('EVAL-HUNG'), 2000))]))); } }
  a = await M();
  const filtMs = await page.evaluate(() => { const ts = []; for (let i = 0; i < 2; i++) { const t = performance.now(); txnFiltTap('kinds', 'thu'); document.body.offsetHeight; ts.push(Math.round(performance.now() - t)); } return ts; });
  out.filter = Object.assign({ perTapMs: filtMs }, d(a, await M()));

  if (process.env.STEP) { console.log('step: idle');
    await page.evaluate(() => { window.__rf = 0; (function t() { window.__rf++; requestAnimationFrame(t); })(); const sc = document.getElementById('txn-scroll'); window.__sc = 0; sc.addEventListener('scroll', () => window.__sc++); window.__mc = 0; const o = window._txMoreCheck; });
    for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 1000)); console.log('idle probe', await Promise.race([page.evaluate(() => JSON.stringify({ rf: window.__rf, sc: window.__sc, st: document.getElementById('txn-scroll').scrollTop, sh: document.getElementById('txn-scroll').scrollHeight, shown: TXV._shown, cur: TXV._cur, nseg: (TXV._segs || []).length })), new Promise((r) => setTimeout(() => r('EVAL-HUNG'), 3000))])); } }
  await new Promise((r) => setTimeout(r, 500));
  a = await M();
  await new Promise((r) => setTimeout(r, 4000));   // headless makes no frames on a still page, so time it rather than rAF-count it
  out.idle4s = d(a, await M());
  out.idle4s.runningAnimations = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').map((x) => {
    const el = x.effect && x.effect.target; let vis = el; while (vis && vis !== document.body && getComputedStyle(vis).visibility !== 'hidden' && getComputedStyle(vis).display !== 'none') vis = vis.parentElement;
    return (x.animationName || x.transitionProperty || '?') + '@' + (el ? (el.id || el.className || el.tagName) : '?') + (vis && vis !== document.body ? ' [hidden-by ' + (vis.id || vis.className) + ']' : ''); }));
  if (process.env.TRACE) {
    await page.tracing.start({ path: process.env.TRACE, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline.stack'] });
    await new Promise((r) => setTimeout(r, 1500));
    await page.tracing.stop();
  }

  a = await M();
  await page.evaluate(() => new Promise((res) => { const sc = document.getElementById('txn-scroll'); const t0 = performance.now(); (function tick() { sc.scrollTop += 40; if (performance.now() - t0 < 2000) setTimeout(tick, 16); else res(); })(); }));
  out.scroll2s = Object.assign(d(a, await M()), await page.evaluate(() => ({ scrollTop: document.getElementById('txn-scroll').scrollTop, rowsInDom: document.querySelectorAll('#txn-list .row').length })));

  const net = await page.evaluate(() => { const L = window.__stubLog || []; const t0 = performance.now() - 7000; const c = {}; L.filter((e) => e.t > t0 && e.phase === 'start').forEach((e) => { c[e.route] = (c[e.route] || 0) + 1; }); return c; });
  const hyd = await page.evaluate(() => window.__hydCalls || []);
  console.log('stub calls in the last ~7s (open→idle→scroll):', JSON.stringify(net));
  if (hyd.length) console.log('fhPersonalHydrate callers:', JSON.stringify(hyd.slice(0, 5)), 'total', hyd.length);
  // Correctness of the progressive list: walk to the bottom the way the scroll
  // handler would (headless dispatches no scroll events without frames).
  const chk = await page.evaluate(() => {
    const res = {};
    const run = (setup) => {
      setup(); const sc = document.getElementById('txn-scroll'); sc.scrollTop = 0; let steps = 0;
      while (_txHasMore() && steps++ < 500) { sc.scrollTop = sc.scrollHeight; _txMoreCheck(); }
      const ids = [...document.querySelectorAll('#txn-list .row')].map((r) => (r.getAttribute('onclick') || '').match(/'([^']+)'/)[1]);
      const want = []; (TXV._segs || []).forEach((g) => g.rows.forEach((t) => want.push(String(t._open ? (t._open.match(/'([^']+)'/) || [])[1] : t.id))));
      const heads = document.querySelectorAll('#txn-list .txn-mhead').length, cards = document.querySelectorAll('#txn-list > .rows').length;
      const last = document.getElementById('txn-list').lastElementChild;
      return { rows: ids.length, list: TXV._list.length, sameOrder: ids.join() === want.join(), heads, cards, groups: TXV._segs.length, tailLast: !!(last && /txn-tail/.test(last.className)) };
    };
    res.day = run(() => { txnSetGrp('day'); });
    res.month = run(() => { txnSetGrp('month'); });
    // same-view re-render keeps what was on screen (selection tap / edit refresh)
    const before = document.querySelectorAll('#txn-list .row').length; renderTxnScreen();
    res.keepOnRerender = document.querySelectorAll('#txn-list .row').length === before;
    txnSetGrp('day');
    return res;
  });
  console.log('correctness:', JSON.stringify(chk));
  console.log(`\n== txn list perf · ${ROWS} rows ==`);
  for (const k of Object.keys(out)) console.log(k.padEnd(9), JSON.stringify(out[k]));
  await browser.close(); srv.close();
})().catch((e) => { console.error('perf crashed:', e); process.exit(2); });
