/* Review queue (#csv-import-modal, staged mode) perf loop — "the phone heats up
   with the queue open". Boots the real built app on the stub (same as harness.js),
   feeds N staged bank-email rows through the stub's `email_transactions` table so
   the REAL open path runs (fhTxnReviewSheet → fhFetchStagedTxns → fhReadStagedRow →
   fhStmtLoad → receipt join → csvBuildReview → renderCsvReview → openSheet), then
   measures each step via CDP Performance metrics + window.fhHeat (07-heat-meter.js):

     open     — fhTxnReviewSheet wall time, DOM nodes, decrypts, fetches, ticks
     expand   — csvToggleExpand on the first ready card (open), then collapse
     filter   — one filter tap (a category / person chip if the chart offers one,
                else the toolbox drawer open+close), reverted
     idle4s   — 4 s with the queue open and nothing touched: task ms, decrypts,
                fetches, render ticks, running animations
     hydrate  — one real window.fhPersonalHydrate() with the queue open: how many
                times the queue repainted (renderCsvReview ticks), decrypts, fetches

   ROWS: the stub holds no sealed rows and no staging key, so the rows are injected
   UNSEALED (`sealed: null`, the plaintext-era shape fhReadStagedRow passes through
   untouched). That makes "decrypts on open" a floor: production adds one NaCl
   unseal per row (the pure-JS cost the heat meter counts as `unseals`).

   TICKS: the meter's fhHeat.tick() has no call sites until the integrator adds
   them, so this harness installs the same one-liners as wrappers around the
   globals (TICK_SHIMS below). The names printed are the names the call sites
   should use; the counts are what they will report.

   HEADLESS GOTCHAS (same as txnlist-perf.js): headless Chrome paints no frames on
   a still page, so rAF never fires and scroll handlers never run — idle is TIMED
   via CDP TaskDuration, not frame-counted, and anything frame-driven must be
   called by hand. Animations are sampled with document.getAnimations(), which
   does not need frames. fhHeat long-task counts can read 0 even when TaskDuration
   is high: PerformanceObserver('longtask') only reports tasks > 50 ms, and a
   hot idle is usually many short tasks.

   Usage: node build.js && node tools/boot-harness/queue-perf.js [rows=300] [--direct]
     --direct   skip the real open path and build the queue from already-opened rows
                injected into window._fhStagedRows (the fallback when the open path
                is gated, e.g. a reading-phase screen) */
let puppeteer;
try { puppeteer = require('puppeteer'); }
catch (e) { puppeteer = require('/Users/hiencao/Documents/ClaudeHC/moneylover/node_modules/puppeteer'); }
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STUB = path.join(__dirname, 'stub-supabase.js');
const argv = process.argv.slice(2);
const ROWS = Number(argv.find((a) => /^\d+$/.test(a)) || 300);
const DIRECT = argv.includes('--direct');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

/* The one-liners the integrator should add at the top of each function
   (`window.fhHeat && fhHeat.tick('<name>')`). Installed here as wrappers so the
   harness already reports them. */
const TICK_SHIMS = ['renderCsvReview', 'renderPersonal', 'renderCashflow', 'renderTxnScreen', 'renderHome', 'loadFamilyData', 'fhPersonalHydrate', 'renderCashflowEmailCta'];

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

/* Served in place of vendor/supabase.js: the stub, plus a patch that lets the page
   hand `email_transactions` rows back through the stub's own builder. The stub
   file itself is untouched. */
const STUB_PATCH = `
;(function () {
  var mk = window.supabase.createClient;
  window.supabase.createClient = function () {
    var c = mk.apply(this, arguments);
    var from = c.from;
    c.from = function (t) {
      var b = from.call(c, t);
      if (t === 'email_transactions') {
        var then = b.then;
        b.then = function (ok, err) {
          return then.call(b, function (r) { if (window.__queueRows) r.data = window.__queueRows.slice(); return r; }).then(ok, err);
        };
      }
      return b;
    };
    return c;
  };
})();`;

function mkRows(n) {
  const provs = ['Techcombank', 'MB', 'VIB', 'Vietcombank', 'MoMo', 'ACB'];
  const payees = ['HIGHLANDS COFFEE NGUYEN HUE', 'GRABFOOD', 'NGUYEN VAN A - 0912345678', 'CIRCLE K Q1', 'SHOPEE', 'BACH HOA XANH', 'TRAN THI B - 0987654321', 'PHUC LONG', 'WINMART', 'BE GROUP'];
  const memos = ['', 'tra tien an trua', 'THANH TOAN DICH VU HANG HOA', 'tien dien thang 9', '', 'chuyen tien', 'mua sach', ''];
  const out = [], t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const at = new Date(t0 - i * 5 * 3600 * 1000);
    const income = i % 23 === 7, amt = income ? 15000000 : 20000 + (i % 300) * 1000;
    const cp = payees[i % payees.length];
    out.push({
      id: 'stg-' + String(i).padStart(5, '0'), member_id: null, owner_user_id: '00000000-0000-4000-8000-000000000001',
      staging_scope: 'personal', gmail_message_id: 'gm' + i, source_provider: provs[i % provs.length],
      occurred_at: at.toISOString(), amount: amt, currency: 'VND', direction: income ? 'in' : 'out',
      counterparty: cp, reference_number: 'FT' + (1000000 + i), transaction_type: 'bank_txn',
      raw_extracted: { v: 2, amount: amt, currency: 'VND', direction: income ? 'in' : 'out', counterparty: cp,
        memo: memos[i % memos.length], memo_display: memos[i % memos.length], account_masked: ['xxxx1234', 'xxxx5678', 'xxxx9012'][i % 3],
        flow: income ? 'in' : 'out', _transport: 'direct', reader_type: i % 5 === 2 ? 'p2p' : 'merchant', transaction_type: 'bank_txn',
        category_hint: i % 4 === 0 ? 'Ăn uống' : null, memo_time: null },
      duplicate_of_id: null, resolved_before: false, sealed: null, eph_pub: null, nonce: null, enc_v: null,
      created_at: at.toISOString(),
    });
  }
  return out;
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const stubJs = fs.readFileSync(STUB, 'utf8') + STUB_PATCH;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('vendor/supabase.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: stubJs });
    if (!r.url().startsWith('http://127.0.0.1')) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
    r.continue();
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  if (process.env.DBG) page.on('console', (m) => console.log('  [console]', m.text().slice(0, 200)));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('fh-resume', '1'); localStorage.setItem('fh-onboarded', '1');
    localStorage.setItem('fh-lang', 'vi'); localStorage.setItem('stub-lat', '20'); localStorage.setItem('stub-rows', '120');
    (async () => {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await new Promise((res) => {
        const rq = indexedDB.open('fh-keys', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('k', { keyPath: 'fid' });
        rq.onsuccess = () => { const tx = rq.result.transaction('k', 'readwrite'); tx.objectStore('k').put({ fid: 'p:00000000-0000-4000-8000-000000000001', key, at: Date.now() }); tx.oncomplete = res; };
      });
    })();
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction(() => window.fhPersonalData && fhPersonalData().key && fhPersonalData().uid && window.fhHeat, { timeout: 30000 }); }
  catch (e) { console.log('not ready:', await page.evaluate(() => JSON.stringify({ st: window.fhPersonalData && fhPersonalData().state, heat: !!window.fhHeat, body: (document.getElementById('pers-body') || {}).innerText }))); throw e; }

  // Stub artifact (see txnlist-perf.js): the label seeder re-hydrates forever
  // because its insert reads back empty. Stop it; keep hydrate itself REAL —
  // the hydrate step below measures the real thing.
  await page.evaluate(() => { window.fhPersonalLabelsEnsureDefaults = async () => false; });
  // HEADLESS: rAF never fires on a still page, and fhTxnReviewSheet's unlock loop
  // yields through requestAnimationFrame every 20 rows (_txrYield) — without this
  // shim the open never resolves. A timer-driven rAF keeps the yield's shape.
  await page.evaluate(() => { window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16); window.cancelAnimationFrame = clearTimeout; });
  await new Promise((r) => setTimeout(r, 1500));

  // Tick shims = the recommended one-line insertions, as wrappers.
  const shimmed = await page.evaluate((names) => {
    const done = [];
    names.forEach((n) => {
      const o = window[n]; if (typeof o !== 'function') return;
      if (String(o).indexOf("fhHeat.tick('" + n + "')") >= 0) { done.push(n + "(self)"); return; }   // the app ticks itself since 2026-10-10: do not double count
      window[n] = function () { window.fhHeat && fhHeat.tick(n); return o.apply(this, arguments); };
      done.push(n);
    });
    return done;
  }, TICK_SHIMS);
  console.log('tick shims installed:', shimmed.join(', '), shimmed.length < TICK_SHIMS.length ? '(missing: ' + TICK_SHIMS.filter((n) => !shimmed.includes(n)).join(', ') + ')' : '');

  const cdp = await page.target().createCDPSession();
  await cdp.send('Performance.enable');
  const M = async () => { const r = await cdp.send('Performance.getMetrics'); const o = {}; r.metrics.forEach((m) => { o[m.name] = m.value; }); return o; };
  const H = () => page.evaluate(() => fhHeat.snapshot());
  const dM = (a, b) => ({ task: ((b.TaskDuration - a.TaskDuration) * 1000) | 0, script: ((b.ScriptDuration - a.ScriptDuration) * 1000) | 0,
    layout: ((b.LayoutDuration - a.LayoutDuration) * 1000) | 0, style: ((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000) | 0,
    layouts: b.LayoutCount - a.LayoutCount, nodes: b.Nodes });
  const dH = (a, b) => ({ decrypts: b.decrypts - a.decrypts, unseals: b.unseals - a.unseals, fetches: b.fetches - a.fetches,
    fetchRest: b.fetchRest - a.fetchRest, fetchRpc: b.fetchRpc - a.fetchRpc, longTasks: b.longTasks - a.longTasks, longTaskMs: b.longTaskMs - a.longTaskMs,
    ticks: Object.fromEntries(Object.keys(b.ticks).map((k) => [k, b.ticks[k] - (a.ticks[k] | 0)]).filter(([, v]) => v)) });
  const out = {};
  const stubCalls = async (sinceMs) => page.evaluate((s) => { const L = window.__stubLog || []; const t0 = performance.now() - s; const c = {}; L.filter((e) => e.t > t0 && e.phase === 'start').forEach((e) => { c[e.route] = (c[e.route] || 0) + 1; }); return c; }, sinceMs);

  // ── open ────────────────────────────────────────────────────────────────
  await page.evaluate((rows) => { window.__queueRows = rows; fhHeat.reset(); }, mkRows(ROWS));
  let a = await M(), h = await H();
  let openMs;
  if (!DIRECT) {
    openMs = await page.evaluate(async () => {
      const t = performance.now();
      const timedOut = await Promise.race([window.fhTxnReviewSheet({ kind: 'personal' }).then(() => false), new Promise((r) => setTimeout(() => r(true), 60000))]);
      document.body.offsetHeight;
      return timedOut ? -1 : Math.round(performance.now() - t);
    });
    if (openMs < 0) console.log('fhTxnReviewSheet did not resolve within 60 s');
  }
  let cards = await page.evaluate(() => ({ on: !!(document.getElementById('csv-import-modal') || {}).classList && document.getElementById('csv-import-modal').classList.contains('on'), cards: document.querySelectorAll('#csv-result .csv-card-body, #csv-result .csv-cards > *').length, ready: window.csvReview ? csvReview.ready.length : -1, staged: (window._fhStagedRows || []).length }));
  if (DIRECT || !cards.on || cards.ready < 1) {
    if (!DIRECT) console.log('real open path did not paint a queue (' + JSON.stringify(cards) + ') — falling back to the direct build path');
    openMs = await page.evaluate(async (rows) => {
      const t = performance.now();
      window.csvEntryScope = window.fhNormScope ? fhNormScope({ kind: 'personal' }) : { kind: 'personal' };
      window._fhStagedRows = rows; window._fhQueueNewAccts = []; window.csvStagedMode = true;
      try { window._fhPersonalMatchSlice = window.fhPersonalMatchSlice ? await fhPersonalMatchSlice() : null; } catch (e) { window._fhPersonalMatchSlice = null; }
      csvLearnLoad();
      // fhStagedAsCsvSource is module-scoped; the same 5-column shape, by hand.
      const COLS = ['occurred_at', 'description', 'amount', 'counterparty', 'category'], columnMap = {};
      COLS.forEach((f, i) => { columnMap[i] = { field: f, confidence: 1 }; });
      const src = { name: 'staged', rows: rows.map((r) => { const x = r.raw_extracted || {}; return [r.occurred_at, x.memo_display || '', String(r.direction === 'in' ? r.amount : -r.amount), r.counterparty || '', x.category_hint || '']; }), headers: COLS, columnMap };
      csvBuildReview([src], {});
      renderCsvReview();
      const pick = document.getElementById('csv-pick'); if (pick) pick.style.display = 'none';
      openSheet('csv-import-modal');
      document.body.offsetHeight;
      return Math.round(performance.now() - t);
    }, mkRows(ROWS));
    cards = await page.evaluate(() => ({ on: document.getElementById('csv-import-modal').classList.contains('on'), cards: document.querySelectorAll('#csv-result .csv-card-body, #csv-result .csv-cards > *').length, ready: window.csvReview ? csvReview.ready.length : -1, staged: (window._fhStagedRows || []).length }));
  }
  out.open = Object.assign({ wallMs: openMs, path: DIRECT ? 'direct' : 'fhTxnReviewSheet' }, cards, dM(a, await M()), dH(h, await H()));
  out.open.stubCalls = await stubCalls(openMs + 500);
  await new Promise((r) => setTimeout(r, 800));   // let the open's fire-and-forget tails (census, badge) land before the next baseline

  // ── expand / collapse ───────────────────────────────────────────────────
  a = await M(); h = await H();
  const exp = await page.evaluate(() => { const t = performance.now(); csvToggleExpand('ready', 0); document.body.offsetHeight; return { ms: Math.round(performance.now() - t), open: !!(window.csvExpand && csvExpand.idx === 0) }; });
  out.expand = Object.assign(exp, dM(a, await M()), dH(h, await H()));
  a = await M(); h = await H();
  const col = await page.evaluate(() => { const t = performance.now(); csvToggleExpand('ready', 0); document.body.offsetHeight; return { ms: Math.round(performance.now() - t), open: !!window.csvExpand }; });
  out.collapse = Object.assign(col, dM(a, await M()), dH(h, await H()));

  // ── filter tap ──────────────────────────────────────────────────────────
  a = await M(); h = await H();
  const filt = await page.evaluate(() => {
    const chip = document.querySelector('#csv-result [onclick^="csvCatFilterGo"], #csv-result [onclick^="csvPersonFilterGo"]');
    const t = performance.now(); let how;
    if (chip) { chip.click(); how = (chip.getAttribute('onclick') || '').slice(0, 40); }
    else { csvToolOpen('pick'); how = 'csvToolOpen(pick)'; }
    document.body.offsetHeight;
    const ms = Math.round(performance.now() - t);
    const t2 = performance.now();
    if (chip) chip.click ? (document.querySelector('#csv-result .ctree-clear') || chip).click() : null; else csvToolClose();
    document.body.offsetHeight;
    return { ms, revertMs: Math.round(performance.now() - t2), how, catFilter: window.csvCatFilter || null, personFilter: window.csvPersonFilter || null };
  });
  out.filter = Object.assign(filt, dM(a, await M()), dH(h, await H()));

  // ── idle 4 s ────────────────────────────────────────────────────────────
  // TRACE=1: record a stack for every stub call during the idle window, print the unique callers.
  if (process.env.TRACE) await page.evaluate(() => { const L = window.__stubLog; const op = L.push.bind(L); window.__stubStacks = []; L.push = function (e) { if (e && e.phase === 'start') window.__stubStacks.push({ t: e.t, route: e.route, stack: String(new Error().stack).split('\n').slice(2, 9).join(' | ') }); return op(e); }; });
  await new Promise((r) => setTimeout(r, 500));
  a = await M(); h = await H();
  await new Promise((r) => setTimeout(r, 4000));
  out.idle4s = Object.assign(dM(a, await M()), dH(h, await H()));
  out.idle4s.runningAnimations = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running' && !(x.effect && x.effect.target && x.effect.target.closest && x.effect.target.closest('#fh-authbusy')))   /* #fh-authbusy: the stub never finishes signing in */.map((x) => {
    const el = x.effect && x.effect.target; let vis = el; while (vis && vis !== document.body && getComputedStyle(vis).visibility !== 'hidden' && getComputedStyle(vis).display !== 'none') vis = vis.parentElement;
    return (x.animationName || x.transitionProperty || '?') + '@' + (el ? (el.id || el.className || el.tagName) : '?') + (el && el.parentElement ? '<' + (el.parentElement.id || el.parentElement.className) : '') + (vis && vis !== document.body ? ' [hidden-by ' + (vis.id || vis.className) + ']' : ''); }));
  out.idle4s.stubCalls = await stubCalls(4000);
  if (process.env.TRACE) { const st = await page.evaluate(() => { const t0 = performance.now() - 4000; const u = {}; (window.__stubStacks || []).filter((x) => x.t > t0).forEach((x) => { const k = x.route + ' :: ' + x.stack; u[k] = (u[k] || 0) + 1; }); return u; }); console.log('idle callers:'); Object.entries(st).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  x' + n + '  ' + k)); }

  // ── one personal hydrate with the queue open ────────────────────────────
  a = await M(); h = await H();
  const hyd = await page.evaluate(async () => {
    try { await window.fhPersonalHydrate({ bg: true }); } catch (e) {}   // settle: the first live refresh after a snapshot boot legitimately changes flags; measure the SECOND
    await new Promise((r) => setTimeout(r, 300));
    const t = performance.now(); let err = null;
    const sig0 = { p: window.fhPersonalSig ? fhPersonalSig() : '', q: window.csvReviewSigCompute ? csvReviewSigCompute() : '' };
    try { await window.fhPersonalHydrate({ bg: true }); } catch (e) { err = String(e); }   // bg = the boot-tail refresh (focus, realtime), the hot path
    const sig1 = { p: window.fhPersonalSig ? fhPersonalSig() : '', q: window.csvReviewSigCompute ? csvReviewSigCompute() : '' };
    const firstDiff = (a, b) => { if (a === b) return null; const A = a.split(/[|\n]/), B = b.split(/[|\n]/); for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return { i, before: String(A[i]).slice(0, 160), after: String(B[i]).slice(0, 160) }; return { i: -1, before: a.length, after: b.length }; };
    window.__sigDiff = { personal: firstDiff(sig0.p, sig1.p), queue: firstDiff(sig0.q, sig1.q) };
    document.body.offsetHeight;
    return { wallMs: Math.round(performance.now() - t), err, state: fhPersonalData().state, queueStillOn: document.getElementById('csv-import-modal').classList.contains('on'), ready: window.csvReview ? csvReview.ready.length : -1 };
  });
  await new Promise((r) => setTimeout(r, 600));   // the post-hydrate tails (snapshot save, stats slice) — part of its cost
  out.hydrate = Object.assign(hyd, dM(a, await M()), dH(h, await H()));
  out.hydrate.stubCalls = await stubCalls(hyd.wallMs + 600);
  out.hydrate.sigDiff = await page.evaluate(() => window.__sigDiff);

  const heat = await page.evaluate(() => fhHeat.snapshot());
  console.log(`\n== review queue perf · ${ROWS} rows · path=${out.open.path} ==`);
  for (const k of Object.keys(out)) console.log(k.padEnd(9), JSON.stringify(out[k]));
  console.log('fhHeat since open (totals):', JSON.stringify({ sinceMs: heat.sinceMs, decrypts: heat.decrypts, unseals: heat.unseals, fetches: heat.fetches, longTasks: heat.longTasks, longTaskMs: heat.longTaskMs, animations: heat.animations, domNodes: heat.domNodes, ticks: heat.ticks, armed: heat.armed }));

  // Bars (tools/boot-harness/README.md "Acceptance bars"). Reported, not enforced
  // yet: the queue is mid-fix, and a red bar is the point of running this.
  // On the stub, requests are STUB CALLS (the stub never touches window.fetch, so
  // fhHeat.fetches reads 0 here by construction; on a real backend it is the
  // number to watch). Each stub call is one request the real client would send.
  const reqs = (c) => Object.values(c).reduce((s, v) => s + v, 0);
  const bars = [
    ['queue idle 4 s: 0 requests', reqs(out.idle4s.stubCalls) === 0, `${reqs(out.idle4s.stubCalls)} stub calls ${JSON.stringify(out.idle4s.stubCalls)} (= ${Math.round(reqs(out.idle4s.stubCalls) * 15)}/min against the spec's bar of 6)`],
    ['queue idle 4 s: 0 decrypts', out.idle4s.decrypts === 0 && out.idle4s.unseals === 0, `${out.idle4s.decrypts} decrypts, ${out.idle4s.unseals} unseals`],
    ['queue idle 4 s: ≤ 1 render tick', Object.values(out.idle4s.ticks).reduce((s, v) => s + v, 0) <= 1, JSON.stringify(out.idle4s.ticks)],
    ['queue idle 4 s: 0 running animations', out.idle4s.runningAnimations.length === 0, out.idle4s.runningAnimations.length + ' running'],
    ['one hydrate with the queue open: 0 queue repaints', (out.hydrate.ticks['renderCsvReview:paint'] | 0) === 0, `${out.hydrate.ticks['renderCsvReview:paint'] | 0} repaint(s), ${out.hydrate.ticks.renderCsvReview | 0} render call(s)`],
    ['one hydrate with the queue open: 0 decrypts of already-cached rows (STUB-LIMITED: its rows are undecryptable, failures are never cached; read this bar on a device)', out.hydrate.decrypts === 0, `${out.hydrate.decrypts} decrypts — NOTE the stub's rows are undecryptable and _decCache (19-personal) remembers only SUCCESSES, so on the stub every hydrate re-pays the failures; with real rows the second hydrate should read 0`],
    ['one hydrate with the queue open: ≤ 1 Personal-tab repaint', (out.hydrate.ticks['renderPersonal:paint'] | 0) <= 1, `${out.hydrate.ticks['renderPersonal:paint'] | 0} repaint(s), ${out.hydrate.ticks.renderPersonal | 0} render call(s)`],
    ['queue open: main-thread task ≤ 200 ms at 300 rows (scaled)', out.open.task <= 200 * Math.max(1, ROWS / 300), `${out.open.task} ms task, ${out.open.wallMs} ms wall incl. ${reqs(out.open.stubCalls)} stub RTTs, ${out.open.longTasks} long task(s)`],
    ['expand / collapse one card ≤ 50 ms each', out.expand.ms <= 50 && out.collapse.ms <= 50, `${out.expand.ms} / ${out.collapse.ms} ms`],
  ];
  console.log('\nbars:');
  for (const [name, ok, detail] of bars) console.log(`  ${ok ? 'GREEN' : 'RED  '}  ${name}  (${detail})`);
  await browser.close(); srv.close();
})().catch((e) => { console.error('queue-perf crashed:', e); process.exit(2); });