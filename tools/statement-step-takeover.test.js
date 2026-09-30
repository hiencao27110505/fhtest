#!/usr/bin/env node
/* A statement step owns the review body, and the badge counts only what the
 * list shows.
 * `node tools/statement-step-takeover.test.js`
 *
 * Two faults, one root, found on a real queue on 2026-09-30.
 *
 *   1. The badge said "25 khoản đang chờ" over a queue of two cards. The other
 *      23 were statement files found while reading history (backfill), and
 *      since the 2026-09-24 declutter those render ONLY inside the toolbox's
 *      "Sao kê cũ" drawer — never as a card. fhStmtPendingCount counted them
 *      anyway, so the badge promised work the screen then refused to show.
 *   2. Opening one of those 23 was impossible. The only door to a backlog card
 *      is that drawer; tapping it painted the unlock step into #csv-result,
 *      which sits UNDER the drawer's scrim (z 20). The password field was on
 *      screen, dimmed, and ate nothing. Nor could the flow render its way out:
 *      a render repaints the queue over the step it just painted.
 *
 * So the properties pinned here are: the count follows the list; every painted
 * step hushes the chrome that overlays it; and renderCsvReview stands aside
 * while a step is open. The last one is proved by letting the real function run
 * BOTH ways — with a flow open it must return before touching the body, and
 * with none it must carry on into the body (and throw in this bare harness,
 * which is the evidence it got past the guard).
 */
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const nodeCrypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

/* A DOM just real enough for the four elements the takeover touches. */
function fakeDoc() {
  const els = {};
  ['csv-toolsheet', 'csv-rowsheet', 'txh', 'csv-result', 'csv-save'].forEach((id) => {
    els[id] = { id: id, innerHTML: '', textContent: '', disabled: false, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } };
  });
  return { els: els, getElementById: (id) => els[id] || null, querySelector: () => null };
}

(async () => {
  /* ── 1. the chrome hush, from the real functions in 56 ─────────────────── */
  console.log('\n-- the step takes the screen (56-csv-import-ui.js) --');
  const S56 = read('src/js-ui/56-csv-import-ui.js');
  const grab = (src, head, tail) => {
    const s = src.indexOf(head); if (s < 0) { console.error('not found: ' + head); process.exit(1); }
    const e = src.indexOf(tail, s); if (e < 0) { console.error('end not found for: ' + head); process.exit(1); }
    return src.slice(s, e + tail.length);
  };
  const hushSrc = grab(S56, 'function csvToolSheetHide()', '\n}')
    + '\n' + grab(S56, 'function csvStepTakeover()', '\n}');
  const doc1 = fakeDoc();
  const hush = new Function('document', 'L', 'csvToolSheet', 'csvEditRow', 'csvBulkArmed',
    hushSrc + '\nreturn { takeover: csvStepTakeover, hide: csvToolSheetHide, state: () => ({ sheet: csvToolSheet, armed: csvBulkArmed }) };'
  )(doc1, (vi) => vi, 'stmtold', null, true);

  doc1.els['csv-toolsheet'].innerHTML = '<div class="cts-scrim"></div><div class="cts">Sao kê cũ</div>';
  doc1.els['csv-rowsheet'].innerHTML = '<div class="crs">row sheet</div>';
  doc1.els['txh'].innerHTML = '<div class="txb">tools</div>';
  doc1.els['csv-save'].disabled = false; doc1.els['csv-save'].textContent = 'Nhập 12';
  hush.takeover();

  t('the drawer that covers the body is gone, scrim and all', doc1.els['csv-toolsheet'].innerHTML === '', doc1.els['csv-toolsheet'].innerHTML);
  t('the row sheet, the other overlay in this modal, is gone too', doc1.els['csv-rowsheet'].innerHTML === '');
  t('the tools header steps aside', doc1.els['txh'].innerHTML === '');
  t('Import cannot promote the queue behind the step', doc1.els['csv-save'].disabled === true && doc1.els['csv-save'].textContent === 'Nhập');
  t('the drawer is HIDDEN, not closed: no render was asked for', hush.state().sheet === null && hush.state().armed === false, hush.state());

  /* ── 2. the guard in renderCsvReview, run both ways ────────────────────── */
  console.log('\n-- renderCsvReview stands aside while a step is open --');
  const rvwSrc = (() => {
    const s = S56.indexOf('function renderCsvReview(){');
    const e = S56.indexOf('\n}', S56.indexOf('csvToolSheetSync();', s));
    if (s < 0 || e < 0) { console.error('renderCsvReview not found — renamed?'); process.exit(1); }
    return S56.slice(s, e + 2);
  })();
  const runRender = (flowOpen) => {
    const doc = fakeDoc();
    doc.els['csv-result'].innerHTML = '<div class="csv-unlock stm-flow">password step</div>';
    const win = { fhStmtFlowActive: () => flowOpen };
    const fn = new Function('window', 'document', 'csvReview', 'csvStagedMode', rvwSrc + '\nreturn renderCsvReview;')(win, doc, {}, true);
    let threw = null;
    try { fn(); } catch (e) { threw = e; }
    return { body: doc.els['csv-result'].innerHTML, threw: threw };
  };
  const held = runRender(true);
  t('with a step open it returns without touching the body', held.body === '<div class="csv-unlock stm-flow">password step</div>' && !held.threw, held);
  const ran = runRender(false);
  t('with no step open it carries on into the body (proof the guard is a guard, not a stop)', !!ran.threw, ran.threw && String(ran.threw.message).slice(0, 60));

  /* ── 3. every painted step calls the hush (77, the real flow) ──────────── */
  console.log('\n-- the flow hushes the chrome on every painted step (77-statement-capture.js) --');
  const SB = await import(path.join(ROOT, 'supabase', 'functions', '_shared', 'mailbox', 'sealed-box.mjs'));
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const kp = nacl.box.keyPair();
  const pub = Buffer.from(kp.publicKey).toString('base64');
  const src18 = read('src/js-data/18-staging-keys.js');
  const fx = (name) => { const j = src18.indexOf('function ' + name); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src18.slice(j, src18.indexOf('\n    }', j) + 6); };
  const fhStagingOpenRow = new Function('nacl', 'STAGING_ENC_V', fx('_sb64ToBytes') + '\n' + fx('fhStagingOpenRow') + '\nreturn fhStagingOpenRow;')(nacl, 1);

  const meta = SB.sealForFamily({ filename: 'vib_08_2026.xlsx', period_month: '2026-08', file_sha256: 'abc' }, pub, OWNER, 'm1', { nacl, rng: nodeCrypto.webcrypto }, 'personal');
  const backlogFile = { id: 'f1', gmail_message_id: 'm1', part_index: 0, source_provider: 'VIB', received_at: '2026-08-20T10:00:00+00:00',
    file_ext: 'xlsx', byte_size: 100, object_path: OWNER + '/f1.sealed', meta_sealed: meta.sealed, meta_eph_pub: meta.eph_pub,
    meta_nonce: meta.nonce, enc_v: meta.enc_v, status: 'pending', backfill: true };

  /* A query stub that REMEMBERS its filters, because which rows the count asks
     for is the whole subject of test 4. Thenable: a count query is awaited with
     no terminal call of its own. */
  const calls = [];
  const countQuery = (table, counts) => {
    const rec = { table: table, eq: {} };
    const q = {
      select: (_c, o) => { rec.head = !!(o && o.head); return q; },
      in: () => q, order: () => q,
      eq: (col, val) => { rec.eq[col] = val; return q; },
      limit: () => Promise.resolve({ data: table === 'statement_files' ? [backlogFile] : [], error: null }),
      then: (res) => { calls.push(rec); return Promise.resolve({ count: counts(rec), error: null }).then(res); },
    };
    return q;
  };
  const doc3 = fakeDoc();
  let hushed = 0;
  const win = {
    fhUser: { id: OWNER }, nacl, fhStagingOpenRow,
    fhPersonalKeyReady: () => true, fhPersonalStagingPrivKey: async () => kp.secretKey,
    fhProviderName: (p) => p,
    csvStepTakeover: () => { hushed++; doc3.els['csv-toolsheet'].innerHTML = ''; },
    renderCsvReview: () => {},
    sb: {
      from: (tbl) => countQuery(tbl, (rec) => {
        if (rec.table === 'statement_rows') return 5;
        // 23 pending files, all backlog — the shape of the real mailbox
        return rec.eq.backfill === false ? 0 : 23;
      }),
      storage: { from: () => ({ download: async () => ({ error: new Error('offline'), data: null }), remove: async () => ({}) }) },
    },
  };
  new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
    read('src/js-data/77-statement-capture.js'))(
    win, {}, (vi) => vi, (s) => String(s), (s) => String(s), async () => null,
    { getItem() { return null; }, setItem() {}, removeItem() {} }, { setItem() {} }, doc3, nodeCrypto.webcrypto);

  await win.fhStmtLoad();
  t('a backlog card is loaded but never rendered in the body', win.fhStmtCards().length === 1 && win.fhStmtCardsHTML() === '' && win.fhStmtOldCards().length === 1);
  t('no flow is open before one is started', win.fhStmtFlowActive() === false);

  // The drawer is open, as it must be for a backlog card to be tappable at all.
  doc3.els['csv-toolsheet'].innerHTML = '<div class="cts-scrim"></div><div class="cts">Sao kê cũ</div>';
  await win.fhStmtOpen('f1');   // download fails -> the error step paints
  t('opening a statement paints into the body', /csv-unlock stm-flow/.test(doc3.els['csv-result'].innerHTML));
  t('and hushes the drawer it was opened from, so the step is reachable', hushed > 0 && doc3.els['csv-toolsheet'].innerHTML === '', { hushed: hushed, sheet: doc3.els['csv-toolsheet'].innerHTML });
  t('the flow now owns the body', win.fhStmtFlowActive() === true);
  win.fhStmtCancel();
  t('leaving the step hands the body back', win.fhStmtFlowActive() === false);
  win.fhStmtOpen('f1');
  win.fhStmtFlowReset();
  t('a fresh open of the queue abandons a step left behind by a closed modal', win.fhStmtFlowActive() === false);

  /* ── 4. the badge counts what the list shows ───────────────────────────── */
  console.log('\n-- the badge counts what the list shows --');
  calls.length = 0;
  const n = await win.fhStmtPendingCount();
  const fileCall = calls.find((c) => c.table === 'statement_files');
  t('the history backlog is not counted as waiting transactions', n === 5, { n: n, expected: 5 });
  t('the count asks only for pending files that are not backlog', !!fileCall && fileCall.eq.status === 'pending' && fileCall.eq.backfill === false, fileCall && fileCall.eq);
  t('parsed statement rows are still counted in full (S15)', calls.some((c) => c.table === 'statement_rows' && c.head === true));

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
  process.exit(fail ? 1 : 0);
})();
