#!/usr/bin/env node
/* PDPL consent: the record belongs to a PERSON, and someone already connected
 * without one still gets asked.
 * `node tools/consent-per-user.test.js`
 *
 * THE INCIDENT (2026-09-22). A test account was deleted and re-created, and the
 * person signed back in on the same tab. `_cstKnown` was module state that
 * sign-out never cleared, so the NEW user inherited the deleted user's "already
 * agreed to v5": the connect gate asked nobody, a real Gmail was connected and a
 * year of mail was read with NO row in user_consents at all. Collection without
 * a recorded consent is the one thing PDPL-COMPLIANCE.md §5 says must never
 * happen, and it took a missing "Sao kê" card to notice, because the statement
 * lane checks the recorded version server-side and had been refusing in silence.
 *
 * The second half is the way back: fhConsentOffer read "no record" as "the
 * connect flow will ask", which is true only for someone not connected yet.
 * Already connected, that person would never be asked again by anything.
 *
 * Both properties are legal, not cosmetic, so they are pinned here rather than
 * left to the behaviour of a cache.
 */
// NOT 'use strict': the eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const consentSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js-data', '75-consent-ui.js'), 'utf8');

// ── stubs ───────────────────────────────────────────────────────────────────
let SHEETS = [];
let CONNECTION = null;          // what fhAutoTxnConnection reports
let SELECT_ROWS = [];           // what user_consents returns
let SELECTS = 0;                // how many times we actually hit the table

global.window = {
  toast: () => {},
  fhUser: { id: 'user-A' },
  fhAutoTxnConnection: async () => CONNECTION,
};
global.document = { getElementById: () => null };
global.sessionStorage = {
  _m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
};
global.setTimeout = () => 0;
function _fhSheet(html) { SHEETS.push(html); }
function _closeOv() {}
const _esc = (s) => String(s == null ? '' : s);
const _escAttr = (s) => String(s == null ? '' : s);
const L = (vi) => vi;
const _mbxGlyph = () => '';
const fmtDayMon = () => '22/09';
const sb = {
  from() {
    const res = () => { SELECTS++; return { data: SELECT_ROWS, error: null }; };
    return {
      select() { return this; }, eq() { return this; }, order() { return this; },
      is() { return this; },
      limit() { return Promise.resolve(res()); },
      then(a, b) { return Promise.resolve(res()).then(a, b); },
      insert() { return Promise.resolve({ error: null }); },
    };
  },
};
async function _rpc() { return {}; }

eval(consentSrc);

const CURRENT = [{ version: FH_CONSENT_V, consented_at: '2026-09-22T07:38:00Z' }];

(async () => {
  // ── the cache is keyed to the person ──────────────────────────────────────
  console.log('\n-- a second account on the same tab is a cache MISS --');

  window.fhUser = { id: 'user-A' };
  SELECT_ROWS = CURRENT; SELECTS = 0; SHEETS = [];
  let ok = await window.fhConsentEnsure(() => {});
  t('A with a current record: passes, one read', ok === true && SELECTS === 1);

  ok = await window.fhConsentEnsure(() => {});
  t('A again: served from cache, no second read', ok === true && SELECTS === 1);

  /* The incident, exactly: same tab, same module state, different person, and
     the new person has no record at all. */
  window.fhUser = { id: 'user-B' };
  SELECT_ROWS = []; SHEETS = [];
  let ran = false;
  ok = await window.fhConsentEnsure(() => { ran = true; });
  t('B (no record) is NOT served A\'s consent: gate refuses',
    ok === false && SHEETS.length === 1 && !ran,
    'ok=' + ok + ' sheets=' + SHEETS.length);
  t('B caused a real read rather than trusting the cache', SELECTS === 2, 'selects=' + SELECTS);

  /* And the other direction: B agreeing must not later answer for A. */
  window.fhUser = { id: 'user-A' };
  SELECT_ROWS = CURRENT; SHEETS = [];
  const before = SELECTS;
  ok = await window.fhConsentEnsure(() => {});
  t('switching back re-reads for A', ok === true && SELECTS === before + 1);

  // ── the way back for someone already connected ────────────────────────────
  console.log('\n-- connected with no record: something must ask --');

  window.fhUser = { id: 'user-C' };
  SELECT_ROWS = []; SHEETS = []; CONNECTION = { email: 'someone@example.com' };
  global.sessionStorage._m = {};
  let went = false;
  let carryOn = await window.fhConsentOffer(() => { went = true; });
  t('connected, no record: the sheet is shown',
    carryOn === false && SHEETS.length === 1, 'carryOn=' + carryOn + ' sheets=' + SHEETS.length);

  SELECT_ROWS = []; SHEETS = []; CONNECTION = null;
  global.sessionStorage._m = {};
  carryOn = await window.fhConsentOffer(() => {});
  t('NOT connected, no record: the connect flow owns the ask, carry on',
    carryOn === true && SHEETS.length === 0);

  SELECT_ROWS = CURRENT; SHEETS = []; CONNECTION = { email: 'someone@example.com' };
  global.sessionStorage._m = {};
  carryOn = await window.fhConsentOffer(() => {});
  t('connected WITH a current record: nothing to say',
    carryOn === true && SHEETS.length === 0);

  /* A statement-lane refusal is server-side and silent, so the only thing
     standing between "no record" and "no statements, forever" is the offer
     above. Pin that it survives a rename of the connection accessor. */
  t('the offer asks the connection, not a cached flag',
    /fhAutoTxnConnection/.test(consentSrc), 'fhConsentOffer no longer checks the connection');
  t('the consent cache is keyed to the uid',
    /_cstUid/.test(consentSrc) && /fhUser/.test(consentSrc), 'uid keying is gone');

  console.log('\n' + (fail ? '  ' + fail + ' FAILED, ' : '  ALL ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
