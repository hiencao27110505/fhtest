#!/usr/bin/env node
/* The "Đã kết nối" screen watches the queue while it is open.
 *
 *   node tools/autotxn-connected-live.test.js
 *
 * Diagnosed 2026-09-05: after a Gmail connect the first rows land ~60s later
 * (the once-a-minute backfill lane), and the old success sheet was static — no
 * count query, no timer, nothing on screen moved. A person watching that minute
 * read it as "it didn't work". The badge only woke on hydrate, focus-resume or
 * a promote, none of which fire for someone who stays on this sheet.
 *
 * So the sheet now polls a HEAD-only pending count while it is open, and these
 * are the promises worth pinning — each one asserted on a RECORD of what the
 * stubs were asked to do, not on returned markup:
 *
 *   1. it asks, and keeps asking on a timer
 *   2. a found count reaches the screen, the CTA, and the global badge
 *   3. it polls with a head-only count — never the sealed-row fetch
 *   4. closing the sheet DEMOTES it to badge-only — the count keeps flowing
 *      to the badge, the dead sheet's DOM is left alone, and ONE reconciling
 *      full refresh runs at the window's end
 *   5. three quiet minutes end it honestly instead of ellipsing forever;
 *      the cadence is eager (1.5s) only while the first find is owed
 *   6. a newer watcher invalidates an older one (no double-poll)
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

const start = src.indexOf('let _atxLiveSeq = 0;');
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

/* Every collaborator records what it was asked to do; the assertions read the
   record. `counts` returns the pending total for the Nth ask, so a scenario is
   just a function of time. */
function harness(countAt) {
  const rec = { asks: 0, sheets: [], fullRefresh: 0, renders: 0, sealedFetches: 0, timers: [], pushRowAsked: 0 };
  const liveEl = { innerHTML: '' };
  const ctaEl = { textContent: '' };
  const state = { sheetOn: true, staged: 0 };
  const scope = {
    sb: { from: (table) => ({
      select: (cols, opts) => {
        if (!opts || !opts.head) rec.sealedFetches++;      // promise 3
        return { eq: () => { rec.asks++; return Promise.resolve({ count: countAt(rec.asks), error: null }); } };
      },
    }) },
    L: (vi) => vi,
    _esc: (s) => String(s),
    _mbxGlyph: () => '',
    _fhSheet: (html) => { rec.sheets.push(html); },
    _mbxPushRow: async () => { rec.pushRowAsked++; return '<div id="push-offer-row"></div>'; },
    _closeOv: () => {},
    window: {
      fhTxnReviewSheet: () => {},
      fhRefreshStagedCount: () => { rec.fullRefresh++; },
      renderCashflowEmailCta: () => { rec.renders++; },
      get fhStagedCount() { return state.staged; },
      set fhStagedCount(v) { state.staged = v; },
    },
    document: {
      hidden: false,
      getElementById: (id) => {
        if (id === 'atx-live') return liveEl;
        if (id === 'atx-live-cta') return ctaEl;
        if (id === 'fh-sheet') return { classList: { contains: () => state.sheetOn } };
        return null;
      },
    },
    Date: { now: () => scope._now },
    setTimeout: (fn, ms) => { rec.timers.push({ fn, ms }); },
    _now: 0,
  };
  const args = Object.keys(scope);
  /* _atxSheetSeq is declared above the extracted block in the real file; the
     harness supplies its own so the block runs stand-alone. */
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
  return { fn, rec, liveEl, ctaEl, state, scope, fire };
}

(async () => {
  console.log('\n-- 1+2: it asks, keeps asking, and a found count reaches every surface --');
  {
    const h = harness((n) => (n < 2 ? 0 : n < 4 ? 12 : 15));
    h.fn('connected');
    await settle();
    t('the success sheet is rendered once', h.rec.sheets.length === 1, 'sheets=' + h.rec.sheets.length);
    t('it asks for the waiting count without being poked', h.rec.asks === 1, 'asks=' + h.rec.asks);
    t('and arms a timer to ask again — eagerly, the first find is owed',
      h.rec.timers.length === 1 && h.rec.timers[0].ms === 1500,
      'timers=' + JSON.stringify(h.rec.timers.map((x) => x.ms)));
    await h.fire();                                   // ask 2 → 12
    t('a found count reaches the live line', h.liveEl.innerHTML.indexOf('12') >= 0, h.liveEl.innerHTML);
    t('...the CTA', h.ctaEl.textContent.indexOf('12') >= 0, h.ctaEl.textContent);
    t('...and the global badge, with the badge surfaces re-rendered',
      h.state.staged === 12 && h.rec.renders === 1,
      'fhStagedCount=' + h.state.staged + ' renders=' + h.rec.renders);
    await h.fire();                                   // ask 3 → still 12
    t('an unchanged count repaints nothing', h.rec.renders === 1, 'renders=' + h.rec.renders);
    await h.fire();                                   // ask 4 → 15
    t('a climbing count keeps climbing on screen', h.liveEl.innerHTML.indexOf('15') >= 0
      && h.state.staged === 15, h.liveEl.innerHTML);
    t('every ask was head-only — the sealed-row fetch is never on this path',
      h.rec.sealedFetches === 0, 'sealedFetches=' + h.rec.sealedFetches);
    t('and once something is found the cadence relaxes to 4s',
      h.rec.timers.length === 1 && h.rec.timers[0].ms === 4000,
      JSON.stringify(h.rec.timers.map((x) => x.ms)));
  }

  console.log('\n-- 4: closing the sheet demotes to badge-only, never to silence --');
  {
    const h = harness((n) => (n < 2 ? 0 : 7));        // the rows land AFTER the close
    h.fn('connected');
    await settle();                                   // ask 1 → 0, sheet open
    h.state.sheetOn = false;                          // closed at five seconds, like a real impatient person
    await h.fire();                                   // ask 2 → 7, now in badge mode
    t('it keeps asking after the close', h.rec.asks === 2, 'asks=' + h.rec.asks);
    t('the badge still learns the count', h.state.staged === 7 && h.rec.renders === 1,
      'fhStagedCount=' + h.state.staged + ' renders=' + h.rec.renders);
    t('but the dead sheet\'s DOM is left alone',
      h.liveEl.innerHTML === '' && h.ctaEl.textContent === '',
      JSON.stringify({ el: h.liveEl.innerHTML, cta: h.ctaEl.textContent }));
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

  console.log('\n-- 5: three quiet minutes end it honestly --');
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
    t('eager only while the first find is owed, then 4s',
      delays.length > 15 && delays.slice(0, 13).every((d) => d === 1500)
      && delays.slice(14).every((d) => d === 4000),
      JSON.stringify(delays.slice(0, 20)));
    t('and the line admits nothing was found rather than ellipsing forever',
      h.liveEl.innerHTML.indexOf('Chưa thấy khoản nào') >= 0, h.liveEl.innerHTML);
    t('with the one reconciling refresh at the end', h.rec.fullRefresh === 1,
      'fullRefresh=' + h.rec.fullRefresh);
  }

  console.log('\n-- 6: a newer watcher invalidates an older one --');
  {
    const h = harness(() => 0);
    h.fn('connected');
    await settle();
    const stale = h.rec.timers.shift();               // the first watcher's timer
    h.fn('connected');                                // reopened: a second watcher
    await settle();
    const asksBefore = h.rec.asks;
    stale.fn();                                       // the old timer fires late
    await settle();
    t('the stale tick asks nothing', h.rec.asks === asksBefore, 'asks=' + h.rec.asks + ' vs ' + asksBefore);
  }

  console.log('\n-- 7: the offer to turn notifications on --');
  {
    const h = harness(() => 0);
    await h.fn('connected');
    const html = h.rec.sheets[0] || '';
    t('the success sheet resolves the push row before rendering',
      h.rec.pushRowAsked === 1 && html.indexOf('push-offer-row') >= 0, 'asked=' + h.rec.pushRowAsked);
    t('and keeps the primary CTA above the offer',
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

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
