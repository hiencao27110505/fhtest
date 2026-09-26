#!/usr/bin/env node
/* The "Đã kết nối" screen watches the queue while it is open.
 *
 *   node tools/autotxn-connected-live.test.js
 *
 * Diagnosed 2026-09-05: after a Gmail connect the first rows land ~60s later
 * (the once-a-minute backfill lane), and the old success sheet was static — no
 * count query, no timer, nothing on screen moved. A person watching that minute
 * read it as "it didn't work".
 *
 * REWRITTEN 2026-09-26 for the consolidated loop (reading-loop-cost-spec): the
 * watcher's recurring request is now a DELTA DRAIN of newly staged rows, not a
 * per-tick head count + grant read + feed refetch. The promises worth pinning,
 * each asserted on a RECORD of what the stubs were asked to do:
 *
 *   1. it seeds, takes ONE baseline count on the seed tick, and from then on
 *      the drain alone carries the count to the screen, CTA and global badge
 *   2. the grant is read on a stride, not per tick — and a finish that stages
 *      nothing is still seen within a stride
 *   3. the baseline is head-only; the sealed-row fetch is never on this path
 *   4. closing the sheet demotes to badge-only: the drain keeps flowing to the
 *      badge, the dead sheet's DOM is left alone, ONE reconciling refresh runs
 *      at the window's end
 *   5. quiet minutes end honestly; the cadence is eager (5s) only while the
 *      first find is owed, then 15s while watched
 *   6. arming again EXTENDS the running watcher: no second timer chain, no
 *      state reset, and the original chain keeps counting afterwards
 *   7. the success sheet OFFERS notifications, resolved before render, below
 *      the primary CTA; and so does the healthy status sheet, while the
 *      reauth sheet keeps its one job
 *
 * The functions are extracted from 74-autotxn-ui.js by name, never copied, so
 * loosening the real file fails here instead of passing against a duplicate.
 */
// NOT 'use strict': the eval'd declarations must land in the harness scope.
const fs = require('fs');
const path = require('path');

const SRC_FILE = path.join(__dirname, '..', 'src', 'js-data', '74-autotxn-ui.js');
const src = fs.readFileSync(SRC_FILE, 'utf8');

const start = src.indexOf("const _atxFrontKey = (gid) =>");
const end = src.indexOf('window.fhAutoTxnDone = fhAutoTxnDone;');
if (start < 0 || end < 0) {
  console.error('FAIL: could not find the live-watch block in ' + SRC_FILE + ' — renamed?');
  process.exit(1);
}
const FN_SRC = src.slice(start, end);

let pass = 0, fail = 0;
const t = (n, ok, d) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : ''));
  ok ? pass++ : fail++;
};
const settle = () => new Promise((r) => setImmediate(r));
const RealDate = Date;

/* Staged rows for the fake table: created_at ascending with the index, so the
   drain's cursor walk is real. occurred_at marches BACKWARDS, like a backfill. */
const mkRows = (n, from) => {
  const out = [];
  for (let i = (from || 0); i < (from || 0) + n; i++) {
    out.push({ id: 'r' + i, source_provider: 'Techcombank',
      occurred_at: '2026-08-' + String(28 - (i % 27)).padStart(2, '0') + 'T00:00:00Z',
      created_at: '2026-09-26T00:' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + 'Z' });
  }
  return out;
};

/* Every collaborator records what it was asked to do; the assertions read the
   record. `state.rows` is the fake email_transactions table; the feed/drain
   branch filters and orders it the way PostgREST would. `countAt` answers the
   Nth head count — the baseline (and the rare drift-heal), nothing else. */
function harness(countAt) {
  const rec = { asks: 0, grantAsks: 0, feedAsks: 0, sheets: [], fullRefresh: 0, renders: 0, sealedFetches: 0, timers: [], pushRowAsked: 0 };
  const liveEl = { innerHTML: '' };
  const pgEl = { innerHTML: '' };
  const ctaEl = { textContent: '', innerHTML: '' };
  const state = { sheetOn: true, staged: 0, phase: 'reading', rows: [] };
  const scope = {
    sb: { from: (table) => ({
      select: (cols, opts) => {
        /* The frontier read (kept for the sheet-open eager paint) asks for one
           clear column; it must never pull a sealed row. */
        if (cols === 'occurred_at') {
          const oldest = () => {
            const r = state.rows.slice().sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1)[0];
            return Promise.resolve({ data: r ? [{ occurred_at: r.occurred_at }] : [], error: null });
          };
          const one = { limit: oldest };
          const ordered = { order: () => one, gte: () => ({ order: () => one }) };
          return { eq: () => ordered };
        }
        /* The seed and the drain: envelope columns plus created_at, filtered
           and ordered like PostgREST. Not a sealed-row FETCH in promise-3's
           sense — the envelope here feeds the on-device open of the feed. */
        if (cols.indexOf('source_provider') >= 0) {
          rec.feedAsks++;
          const q = { _gt: null, _asc: false };
          const run = (n) => {
            let rows = state.rows.slice();
            if (q._gt != null) rows = rows.filter((r) => r.created_at > q._gt);
            rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
            if (!q._asc) rows.reverse();
            return Promise.resolve({ data: rows.slice(0, n), error: null });
          };
          const chain = {
            eq: () => chain,
            gt: (col, v) => { q._gt = v; return chain; },
            order: (col, o) => { q._asc = !!(o && o.ascending); return chain; },
            limit: (n) => run(n),
          };
          return chain;
        }
        if (!opts || !opts.head) rec.sealedFetches++;      // promise 3
        return { eq: () => { rec.asks++; return Promise.resolve({ count: countAt(rec.asks), error: null }); } };
      },
    }) },
    localStorage: { getItem: () => null, setItem: () => {} },
    ATX_DEFAULT_DAYS: 90,
    fmtDayMon: (d) => 'D' + d.getUTCDate(),
    _atxConnection: async () => { rec.grantAsks++; return { id: 'g1', phase: state.phase, backfillDays: 90 }; },
    L: (vi) => vi,
    _esc: (s) => String(s),
    _escAttr: (s) => String(s),
    _mbxGlyph: () => '',
    _fhSheet: (html) => { rec.sheets.push(html); },
    _mbxPushRow: async () => { rec.pushRowAsked++; return '<div id="push-offer-row"></div>'; },
    _closeOv: () => {},
    window: {
      /* fhTxnReviewSheet ABSENT by default: with the review screen available,
         fhAutoTxnDone('connected') routes there (activation-journey-spec Q18)
         and the sheet below is the fallback — these blocks exercise the
         fallback. The screen route has its own block at the bottom. */
      fhRefreshStagedCount: () => { rec.fullRefresh++; },
      renderCashflowEmailCta: () => { rec.renders++; },
      get fhStagedCount() { return state.staged; },
      set fhStagedCount(v) { state.staged = v; },
    },
    document: {
      hidden: false,
      addEventListener: () => {},
      getElementById: (id) => {
        if (id === 'atx-live') return liveEl;
        if (id === 'atx-pg') return pgEl;
        if (id === 'atx-live-cta') return ctaEl;
        if (id === 'fh-sheet') return { classList: { contains: () => state.sheetOn } };
        return null;
      },
    },
    Date: class extends RealDate { static now() { return scope._now; } },
    setTimeout: (fn, ms) => { rec.timers.push({ fn, ms }); },
    _now: 0,
  };
  const args = Object.keys(scope);
  /* _atxSheetSeq is declared above the extracted block in the real file; the
     harness supplies its own so the block runs stand-alone. The meter, the
     open cache and the open/seed/drain helpers all live INSIDE the block, so
     the real ones run — harness rows carry no `sealed`, which makes
     _atxOpenFind's early return the no-crypto path by construction. */
  // eslint-disable-next-line no-new-func
  const make = new Function(...args, 'var _atxSheetSeq = 0;\n' + FN_SRC + '\nreturn fhAutoTxnDone;');
  const fn = make(...args.map((k) => scope[k]));
  /* Fires the oldest armed timer, advancing the virtual clock by its delay. */
  async function fire() {
    const timer = rec.timers.shift();
    if (!timer) return false;
    scope._now += timer.ms;
    timer.fn();
    await settle();
    return true;
  }
  return { fn, rec, liveEl, pgEl, ctaEl, state, scope, fire };
}

(async () => {
  console.log('\n-- 1+2: seed once, then the drain carries the count to every surface --');
  {
    const h = harness((n) => (n === 1 ? 0 : 12));
    h.fn('connected');
    await settle();
    t('the success sheet is rendered once', h.rec.sheets.length === 1, 'sheets=' + h.rec.sheets.length);
    t('an empty queue costs one honest baseline, nothing else', h.rec.asks === 1, 'asks=' + h.rec.asks);
    t('and arms a timer to ask again — eagerly, the first find is owed',
      h.rec.timers.length === 1 && h.rec.timers[0].ms === 5000,
      'timers=' + JSON.stringify(h.rec.timers.map((x) => x.ms)));
    h.state.rows = mkRows(12);                        // the kick lands
    await h.fire();                                   // seed tick: cursor set, baseline re-taken
    t('the seed tick re-baselines AFTER the seed, so the kick\'s rows are counted',
      h.rec.asks === 2 && h.pgEl.innerHTML.indexOf('12') >= 0, 'asks=' + h.rec.asks + ' pg=' + h.pgEl.innerHTML);
    t('...but no CTA into the queue while the read is still running',
      h.ctaEl.innerHTML === '', h.ctaEl.innerHTML);
    t('...and the global badge, with the badge surfaces re-rendered',
      h.state.staged === 12 && h.rec.renders >= 1,
      'fhStagedCount=' + h.state.staged + ' renders=' + h.rec.renders);
    const renders0 = h.rec.renders;
    await h.fire();                                   // drain: nothing new
    t('an unchanged queue repaints nothing', h.rec.renders === renders0, 'renders=' + h.rec.renders);
    h.state.rows = h.state.rows.concat(mkRows(3, 12));
    await h.fire();                                   // drain: 3 new rows
    t('a climbing count climbs on screen WITHOUT another head count',
      h.pgEl.innerHTML.indexOf('15') >= 0 && h.state.staged === 15 && h.rec.asks === 2,
      'asks=' + h.rec.asks + ' pg=' + h.pgEl.innerHTML);
    t('the grant is read on a stride, not per tick (~300 requests bought four static columns)',
      h.rec.grantAsks >= 1 && h.rec.grantAsks <= 2, 'grantAsks=' + h.rec.grantAsks);
    h.state.phase = 'done';                           // backfilled_at lands, staging nothing
    /* the review screen has loaded by now (it was absent at connect time so the
       fallback sheet rendered) — the finish CTA routes into it */
    h.scope.window.fhTxnReviewSheet = () => {};
    let flips = 0;
    while (h.ctaEl.innerHTML === '' && flips < 4) { await h.fire(); flips++; }
    t('a finish that stages nothing is still seen within a stride, and the CTA is born with the count',
      h.ctaEl.innerHTML.indexOf('15') >= 0 && h.ctaEl.innerHTML.indexOf('fhTxnReviewSheet') >= 0,
      'after ' + flips + ' ticks: ' + h.ctaEl.innerHTML);
    t('every count was head-only — the sealed-row fetch is never on this path',
      h.rec.sealedFetches === 0, 'sealedFetches=' + h.rec.sealedFetches);
    t('the seed/drain ran, and asked the table like PostgREST', h.rec.feedAsks > 0,
      'feedAsks=' + h.rec.feedAsks);
    /* REGRESSION GUARD (2026-09-05, kept 2026-09-26). The liveness probe used
       to be #atx-live, which only the CONNECT sheet renders — so opening the
       STATUS sheet mid-backfill demoted the watcher to badge-only on tick one.
       #atx-pg is on both sheets and the review screen, and must stay the
       probe; surfaced is judged per tick, never latched. */
    t('the alive probe is #atx-pg on ANY live surface — sheet or the review screen',
      /const pg = document\.getElementById\('atx-pg'\);\s*\n\s*const sheet/.test(src)
      && /csv-import-modal/.test(src) && /surfaced = !!pg &&/.test(src));
    t('the feed asks for the sealed envelope AND the clear fallback columns',
      /ATX_FEED_COLS = 'id,source_provider,occurred_at,staging_scope,sealed,eph_pub,nonce,enc_v'/.test(src));
    t('...and a row with nothing opened still renders provider + date, never a padlock',
      /const lead = r\._desc \|\| name;/.test(src) && /r\._desc \? \(when \? name/.test(src));
    t('...with the amount divided by curMult, since staged amounts are full VND',
      /Number\(r\._amount\)[\s\S]{0,40}\/ mult/.test(src));
  }

  console.log('\n-- 3b: the STATUS sheet repaints too (no #atx-live on it) --');
  {
    const h = harness((n) => (n === 1 ? 0 : 9));
    h.scope.document.getElementById = (id) => {
      if (id === 'atx-pg') return h.pgEl;              // status sheet has this
      if (id === 'atx-live') return null;              // ...and not this
      if (id === 'atx-live-cta') return h.ctaEl;
      if (id === 'fh-sheet') return { classList: { contains: () => h.state.sheetOn } };
      return null;
    };
    h.fn('connected');
    await settle();
    h.state.rows = mkRows(9);
    await h.fire();
    t('a status-shaped sheet still gets its progress card painted',
      h.pgEl.innerHTML.indexOf('9') >= 0, h.pgEl.innerHTML);
    let n = 0; while (await h.fire()) { if (++n > 300) break; }
    t('and the window still ends cleanly with no #atx-live to write to',
      h.rec.fullRefresh === 1, 'fullRefresh=' + h.rec.fullRefresh);
  }

  console.log('\n-- 4: closing the sheet demotes to badge-only, never to silence --');
  {
    const h = harness((n) => (n === 1 ? 0 : 7));
    h.fn('connected');
    await settle();                                   // tick 1: queue still empty
    const pgAtClose = h.pgEl.innerHTML;               // whatever the open sheet painted
    h.state.sheetOn = false;                          // closed at five seconds, like a real impatient person
    h.state.rows = mkRows(7);                         // the rows land AFTER the close
    await h.fire();                                   // seed tick, in badge mode
    t('it keeps draining after the close', h.rec.feedAsks >= 2, 'feedAsks=' + h.rec.feedAsks);
    t('the badge still learns the count', h.state.staged === 7 && h.rec.renders >= 1,
      'fhStagedCount=' + h.state.staged + ' renders=' + h.rec.renders);
    t('but the dead sheet\'s DOM is left alone',
      h.pgEl.innerHTML === pgAtClose && h.ctaEl.innerHTML === '',
      JSON.stringify({ pg: h.pgEl.innerHTML, cta: h.ctaEl.innerHTML }));
    t('no full refresh yet — that waits for the window end', h.rec.fullRefresh === 0,
      'fullRefresh=' + h.rec.fullRefresh);
    let fired = 0;
    while (await h.fire()) { if (++fired > 300) break; }
    t('the window still ends', fired <= 300, 'fired=' + fired);
    t('with exactly one reconciling refresh', h.rec.fullRefresh === 1,
      'fullRefresh=' + h.rec.fullRefresh);
    t('and no quiet-line ghost-written into a closed sheet', h.liveEl.innerHTML === '',
      h.liveEl.innerHTML);
  }

  console.log('\n-- 5: quiet minutes end it honestly --');
  {
    const h = harness(() => 0);
    h.fn('connected');
    await settle();
    let fired = 0;
    const delays = [];
    while (h.rec.timers.length) {
      delays.push(h.rec.timers[0].ms);
      if (!(await h.fire())) break;
      if (++fired > 200) break;
    }
    t('the timer chain terminates', fired <= 200, 'fired=' + fired);
    t('eager (5s) only while the first find is owed, then 15s while watched — never the old 1.5s hammer',
      delays.length > 6 && delays.slice(0, 4).every((d) => d === 5000)
      && delays.slice(4).every((d) => d === 15000),
      JSON.stringify(delays.slice(0, 24)));
    t('and the line admits nothing was found rather than ellipsing forever',
      h.liveEl.innerHTML.indexOf('Chưa thấy khoản nào') >= 0, h.liveEl.innerHTML);
    t('with the one reconciling refresh at the end', h.rec.fullRefresh === 1,
      'fullRefresh=' + h.rec.fullRefresh);
  }

  console.log('\n-- 6: arming again extends the running watcher, never doubles it --');
  {
    const h = harness((n) => (n === 1 ? 0 : 5));
    h.fn('connected');
    await settle();
    t('one timer chain after the first arm', h.rec.timers.length === 1, 'timers=' + h.rec.timers.length);
    h.fn('connected');                                // reopened: same watcher, deadline pushed
    await settle();
    t('a second arm starts NO second chain and re-asks nothing',
      h.rec.timers.length === 1 && h.rec.asks === 1,
      'timers=' + h.rec.timers.length + ' asks=' + h.rec.asks);
    h.state.rows = mkRows(5);
    await h.fire();
    t('and the original chain is still alive and counting afterwards',
      h.state.staged === 5, 'fhStagedCount=' + h.state.staged);
  }

  console.log('\n-- 7: the offer to turn notifications on --');
  {
    const h = harness(() => 0);
    await h.fn('connected');
    const html = h.rec.sheets[0] || '';
    t('the success sheet resolves the push row before rendering',
      h.rec.pushRowAsked === 1 && html.indexOf('push-offer-row') >= 0, 'asked=' + h.rec.pushRowAsked);
    t('and keeps the (initially empty) CTA slot above the offer',
      html.indexOf('atx-live-cta') >= 0 && html.indexOf('atx-live-cta') < html.indexOf('push-offer-row'),
      'cta@' + html.indexOf('atx-live-cta') + ' offer@' + html.indexOf('push-offer-row'));
  }
  {
    /* The status sheet, extracted on its own. _atxPushRowSafe's real wiring is
       pinned by the section above; here a pass-through stands in so the
       assertions are about WHERE the row lands, branch by branch. */
    const s2 = src.indexOf('async function fhAutoTxnStatus(');
    const e2 = src.indexOf('window.fhAutoTxnStatus = fhAutoTxnStatus;');
    t('fhAutoTxnStatus is still where the extraction expects', s2 >= 0 && e2 > s2);
    const h = harness(() => 0);
    const argNames = Object.keys(h.scope);
    // eslint-disable-next-line no-new-func
    const makeStatus = new Function(...argNames,
      'var _atxSheetSeq = 0;\n' +
      'async function _atxPushRowSafe() { return _mbxPushRow(); }\n' +
      src.slice(s2, e2) + '\nreturn fhAutoTxnStatus;');
    const st = makeStatus(...argNames.map((k) => h.scope[k]));
    await st({ email: 'a@gmail.com', needsReauth: false, scope: 'personal' });
    t('the healthy status sheet carries the offer',
      (h.rec.sheets[0] || '').indexOf('push-offer-row') >= 0);
    await st({ email: 'a@gmail.com', needsReauth: true, scope: 'personal' });
    t('the reauth sheet keeps its one job — no offer',
      (h.rec.sheets[1] || '').indexOf('push-offer-row') < 0
      && (h.rec.sheets[1] || '').indexOf('atx-go') >= 0);
  }

  console.log('\n-- the screen route: with the review screen available, connected lands there --');
  {
    const h = harness(() => 0);
    let opened = null;
    h.scope.window.fhTxnReviewSheet = async (ctx) => { opened = ctx; };
    await h.fn('connected');
    await settle();
    t('connected opens the review screen instead of the sheet', !!opened && h.rec.sheets.length === 0);
    t('the screen opens on the grant\'s own scope', opened && opened.scope === 'personal');
    t('the banner is told this is first light', h.scope.window._rvwJustConnected === true);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
