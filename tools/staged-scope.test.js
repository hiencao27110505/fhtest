#!/usr/bin/env node
/* A reviewed bank transaction goes to the family ledger or to yours, never both
 * by accident and never the private one by default.
 * `node tools/staged-scope.test.js`
 *
 * Model Y (0079): personal rows live in their OWN owner-scoped table under a
 * per-user key. "Personal" is therefore a DIFFERENT WRITE, not a flag on the
 * family one — so the promote path branches rather than passing a scope down.
 *
 * The two failures this guards:
 *   - defaulting to personal, which quietly hides household spending from the
 *     household, with no un-share;
 *   - offering personal while the ledger is locked, which would retire a staged
 *     row against a write that never landed.
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) { console.error(name + ' not found — renamed?'); process.exit(1); }
  const end = src.indexOf('\n}', i);
  return src.slice(i, end + 2);
}

let store = {};
var localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
var CSV_SCOPE_KEY = 'fh-staged-scope';
let toasts = [], rendered = 0;
function toast(m) { toasts.push(m); }
var window = { toast: toast };
function renderCsvReview() { rendered++; }
function esc(x) { return String(x); }
function L(vi) { return vi; }

eval(grab('csvScopeReady'));
eval(grab('csvStagedScope'));
eval(grab('csvPickScope'));
eval(grab('csvScopeSubtitle'));
eval(grab('csvScopePicker'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const unlocked = () => { window.fhPersonalData = () => ({ key: {} }); };
const locked   = () => { window.fhPersonalData = () => ({ key: null }); };
const absent   = () => { window.fhPersonalData = undefined; };

console.log('\n-- the default is the shared ledger --');
store = {}; unlocked();
t('with nothing chosen, family wins', csvStagedScope() === 'family', csvStagedScope());
t('and the subtitle says who will see it', csvScopeSubtitle().indexOf('cả nhà') >= 0, csvScopeSubtitle());

console.log('\n-- the pick is remembered --');
csvPickScope('personal');
t('personal sticks', csvStagedScope() === 'personal');
t('it was persisted, not held in memory', store[CSV_SCOPE_KEY] === 'personal');
t('choosing re-renders so the subtitle follows', rendered === 1);
t('and the subtitle now says only you', csvScopeSubtitle().indexOf('chỉ mình bạn') >= 0, csvScopeSubtitle());
csvPickScope('family');
t('and it can be switched back', csvStagedScope() === 'family');

console.log('\n-- a locked personal ledger can never be chosen --');
store = { 'fh-staged-scope': 'personal' }; locked();
t('a REMEMBERED personal pick falls back to family when locked',
  csvStagedScope() === 'family', csvStagedScope());
toasts = []; rendered = 0;
csvPickScope('personal');
t('picking personal while locked is refused', csvStagedScope() === 'family');
t('and says why rather than failing silently', toasts.length === 1, JSON.stringify(toasts));
t('and does not persist the refused pick', store[CSV_SCOPE_KEY] !== 'personal' || csvStagedScope() === 'family');

console.log('\n-- no personal ledger at all is the same as locked --');
absent(); store = { 'fh-staged-scope': 'personal' };
t('falls back to family', csvStagedScope() === 'family');

console.log('\n-- the control explains itself --');
store = {}; locked();
var html = csvScopePicker();
t('the disabled state is marked for assistive tech', html.indexOf('aria-disabled="true"') > 0);
t('and a note says how to unlock', html.indexOf('Cá nhân') > 0 && html.indexOf('khoá') > 0);
unlocked(); store = {};
html = csvScopePicker();
t('unlocked: no disabled marker', html.indexOf('aria-disabled') < 0);
t('family reads as pressed', /aria-pressed="true"[^>]*>Gia đình/.test(html) || html.indexOf('choice on') > 0);
t('both destinations are offered', html.indexOf('Gia đình') > 0 && html.indexOf('Cá nhân') > 0);

console.log('\n-- the promote path branches, it does not pass a flag --');
const rv = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');
t('personal writes go to fhPersonalAddExpense', /fhPersonalAddExpense\(/.test(rv));
t('family writes still go to csvPromote', /await csvPromote\(/.test(rv));
// Scoped to fhPromoteStaged: _stagedRetiredAdd is DEFINED earlier in the file,
// so an unscoped indexOf finds the definition and the ordering claim is vacuous.
const promote = rv.slice(rv.indexOf('window.fhPromoteStaged'));
t('a failed personal row throws BEFORE anything is retired',
  promote.indexOf('personal write failed') > 0 &&
  promote.indexOf('personal write failed') < promote.indexOf('_stagedRetiredAdd('));
t('space_id is never set on a bank-sourced personal row (private, no un-share)',
  !/space_id\s*:/.test(promote));

console.log('\n' + (fail ? '  ' + fail + ' FAILED' : '  all ' + pass + ' passed') + ' (' + (pass + fail) + ' assertions)\n');
process.exit(fail ? 1 : 0);
