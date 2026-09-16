#!/usr/bin/env node
/* Period comparison (docs/specs/period-comparison-spec.md): the grey bar
 * behind every bar of both cash-flow charts compares with the SAME earlier
 * period, chosen by one rule set.
 * `node tools/period-compare.test.js`
 *
 * Runs src/js-ui/19-period-compare.js (pure date math, no DOM) in a vm and
 * checks the spec's worked examples and acceptance cases, then source-shape
 * guards that both charts actually go through it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const R = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const ctx = { isVi: () => true };
vm.createContext(ctx);
vm.runInContext(R('src/js-ui/19-period-compare.js'), ctx);
const F = ctx;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* ── day ── */
t('day ↔ the same weekday last week, across a year boundary', () => {
  assert.strictEqual(F.fhCmpDay('2026-01-01'), '2025-12-25');
  assert.strictEqual(F.fhWdShort('2025-12-25'), 'T5');
  assert.strictEqual(F.fhDM('2025-12-25'), '25/12');
});

/* ── week: shift the Monday one month back, snap to that Monday ── */
t('week: 15 Sep 2026 → 15 Aug (Sat) → week of Mon 10 Aug', () => assert.strictEqual(F.fhCmpWeek('2026-09-14'), '2026-08-10'));
t('week: 31 Aug 2026 → 31 Jul (Fri) → week of Mon 27 Jul', () => assert.strictEqual(F.fhCmpWeek('2026-08-31'), '2026-07-27'));
t('week: 5 Jan 2026 → 5 Dec 2025 (Fri) → week of Mon 1 Dec', () => assert.strictEqual(F.fhCmpWeek('2026-01-05'), '2025-12-01'));
t('week: 30 Mar 2026 → clamped to 28 Feb (Sat) → week of Mon 23 Feb', () => assert.strictEqual(F.fhCmpWeek('2026-03-30'), '2026-02-23'));
t('week: a fifth week (Mon 28 Sep 2026) always has a partner', () => assert.strictEqual(F.fhCmpWeek('2026-09-28'), '2026-08-24'));
t('week: the partner is itself a Monday, weekdays stay aligned', () => {
  for (const m of ['2026-09-14', '2026-08-31', '2026-01-05', '2026-03-30', '2026-09-28']) {
    assert.strictEqual(F.fhParseDate(F.fhCmpWeek(m)).getDay(), 1);
  }
});

/* ── month ── */
t('month: previous month + same month last year, January wraps the year', () => {
  const a = F.fhCmpMonth('2026-01'), b = F.fhCmpMonth('2026-09');   // plain-object compare across the vm realm
  assert.strictEqual(a.prev + ' ' + a.ly, '2025-12 2025-01');
  assert.strictEqual(b.prev + ' ' + b.ly, '2026-08 2025-09');
});

/* ── coverage: no grey ≠ zero grey ── */
t('covered only when the comparison period starts on/after the first row', () => {
  const first = '2026-08-20';
  assert.strictEqual(F.fhCovered('2026-08-18', first), false);   // 25 Aug vs 18 Aug → no grey
  assert.strictEqual(F.fhCovered('2026-08-20', first), true);    // 27 Aug vs 20 Aug → grey (maybe zero)
  assert.strictEqual(F.fhCovered('2026-08-01', first), false);   // Aug as a month: not covered
  assert.strictEqual(F.fhCovered('2026-09-01', first), true);
});
t('unknown ledger start (slice not landed) = not covered', () => assert.strictEqual(F.fhCovered('2026-09-01', null), false));

/* ── buổi ── */
t('buổi boundaries 5/11/14/18; 0–4h is Tối of the same date', () => {
  assert.deepStrictEqual([0, 4, 5, 10, 11, 13, 14, 17, 18, 23].map(F.fhBuoiIdx), [3, 3, 0, 0, 1, 1, 2, 2, 3, 3]);
});
t('own occurred_time wins: 01:30 on 12 Sep → Tối of 12 Sep', () => assert.strictEqual(F.fhBuoiOf('2026-09-12', '01:30', '2026-09-13T09:00:00+07:00'), 3));
t('no time, logged the same day 09:00 → Sáng', () => {
  const ts = new Date(2026, 8, 12, 9, 0);
  assert.strictEqual(F.fhBuoiOf('2026-09-12', null, ts), 0);
});
t('no time, logged the NEXT day (email backfill) → no buổi', () => {
  const ts = new Date(2026, 8, 13, 9, 0);
  assert.strictEqual(F.fhBuoiOf('2026-09-12', null, ts), null);
  assert.strictEqual(F.fhBuoiOf('2026-09-12', null, null), null);
});
t('a family occurred_time with seconds parses', () => assert.strictEqual(F.fhBuoiOf('2026-09-12', '19:05:00', null), 3));

/* ── the charts go through the module ── */
const fam = R('src/js-ui/20-budget.js');
const pers = R('src/js-ui/21-personal.js');
const data = R('src/js-data/19-personal.js');
const css = R('src/css/40-spending-tabs.css');
t('family live views use the shared rules by DATE, not the year-less month key', () => {
  assert.ok(/function cfDayMap\(/.test(fam));
  assert.ok(/fhCmpDay\(/.test(fam) && /fhCovered\(/.test(fam) && /fhBuoiOf\(/.test(fam));
  const live = fam.slice(fam.indexOf('function cfDayMap('), fam.indexOf('/* Daily guide'));
  assert.ok(!/t\.month===/.test(live), 'live views must not key on t.month');
  assert.ok(!/cfPrevMonthDaily/.test(fam), 'the year-less previous-month lookup is gone');
});
t('family buổi: the same weekday last week, own time first, untimed said out loud', () => {
  assert.ok(/prevD=fhCmpDay\(today\)/.test(fam));
  assert.ok(/chưa rõ giờ/.test(fam));
  assert.ok(!/unknown → current buổi/.test(fam));
});
t('personal strip: grey + tick + red, upcoming slots, all four zooms', () => {
  assert.ok(/fhCmpWeek\(/.test(pers) && /fhCmpMonth\(/.test(pers) && /fhCmpDay\(/.test(pers));
  assert.ok(/class="pst-p"/.test(pers) && /class="pst-y"/.test(pers) && /pst-b'\+\(over\?' over'/.test(pers));
  assert.ok(/\['buoi','day','week','month'\]\.indexOf\(window\.persZoomM\)/.test(pers));
  assert.ok(/\['day','week','month'\]\.indexOf\(window\.persZoomA\)/.test(pers), 'all-time never offers buổi');
  assert.ok(/\['buoi','Buổi','Daypart'\]/.test(pers));
  assert.ok(/sheet-pzoom/.test(pers) && /buildPZoomChoices/.test(pers), 'the period picker is a sheet, not a segmented row');
  assert.ok(/function persCmpName/.test(pers), 'the legend names the comparison per zoom');
  assert.ok(/if\(pk==='buoi'\) pk='day'/.test(pers), 'guide stays per-day under buổi zoom');
});
t('personal strip: comparisons never wait on the slice, and the slice carries the time', () => {
  assert.ok(/if\(!D\.complete\) persEnsureSlice\(\)/.test(pers));
  assert.ok(/_persOldMap/.test(pers));
  assert.ok(/occurred_time_enc,created_at/.test(data));
  assert.ok(/time: t\.occurred_time_enc \? await _decTxt\(t\.occurred_time_enc\) : null, ts: t\.created_at/.test(data));
});
t('CSS: grey behind, red over, tick, buổi groups', () => {
  for (const s of ['.pst-p{', '.pst-b.over{', '.pst-y{', '.pst.buoi{', '.pst-g{', '.pst-c.now .pst-bars{', '.pst-pin small{',
                   '.pchead{', '.pch-menu{', '.pch-c{', '.pleg{', '.pst::after{']) assert.ok(css.includes(s), s);
});

console.log(`period-compare: ${n} checks passed`);
