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
eval(grab('csvSetScope'));
eval(grab('csvPickScope'));
eval(grab('csvRowScope'));
eval(grab('csvRowScopeField'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const unlocked = () => { window.fhPersonalData = () => ({ key: {} }); };
const locked   = () => { window.fhPersonalData = () => ({ key: null }); };
const absent   = () => { window.fhPersonalData = undefined; };

console.log('\n-- the default is the shared ledger --');
store = {}; unlocked();
t('with nothing chosen, family wins', csvStagedScope() === 'family', csvStagedScope());
t('an undecided row inherits that default', csvRowScope({}) === 'family');

console.log('\n-- but the DESTINATION belongs to the row, not the batch --');
t('a row can be personal while the default is family',
  csvRowScope({ _scope: 'personal' }) === 'personal');
t('and family while the default is personal',
  (function(){ store={'fh-staged-scope':'personal'}; var r=csvRowScope({_scope:'family'}); store={}; return r==='family'; })());
t('a row with no opinion still follows the default',
  (function(){ store={'fh-staged-scope':'personal'}; var r=csvRowScope({}); store={}; return r==='personal'; })());

console.log('\n-- a locked personal ledger can never strand a row --');
store = { 'fh-staged-scope': 'personal' }; locked();
t('a remembered personal default falls back to family', csvStagedScope() === 'family');
t('AND a row explicitly marked personal falls back too — it must still import',
  csvRowScope({ _scope: 'personal' }) === 'family');
toasts = []; rendered = 0;
csvPickScope('personal');
t('setting the default to personal while locked is refused', csvStagedScope() === 'family');
t('and says why rather than failing silently', toasts.length === 1, JSON.stringify(toasts));

console.log('\n-- no personal ledger at all is the same as locked --');
absent(); store = { 'fh-staged-scope': 'personal' };
t('falls back to family', csvStagedScope() === 'family');

console.log('\n-- the control explains itself --');
store = {}; locked();
var html = csvRowScopeField({});
t('the disabled state is marked for assistive tech', html.indexOf('aria-disabled="true"') > 0);
t('and a note says how to unlock', html.indexOf('Cá nhân') > 0 && html.indexOf('khoá') > 0);
unlocked(); store = {};
html = csvRowScopeField({});
t('unlocked: no disabled marker', html.indexOf('aria-disabled') < 0);
t('family reads as pressed', /aria-pressed="true"[^>]*>Gia đình/.test(html) || html.indexOf('choice on') > 0);
t('both destinations are offered', html.indexOf('Gia đình') > 0 && html.indexOf('Cá nhân') > 0);

console.log('\n-- the Cá nhân tab has the same door, pre-scoped --');
const ptab = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '21-personal.js'), 'utf8');
t('the tab carries the email CTA', /Khoản thu chi từ email/.test(ptab));
// The source escapes its quotes inside a single-quoted string, so a regex here
// guards the QUOTING more than the behaviour. Substring check instead.
t('and opens it pre-scoped to personal',
  ptab.indexOf('fhEmailTxnCta({scope:') > 0 &&
  ptab.slice(ptab.indexOf('fhEmailTxnCta({scope:'), ptab.indexOf('fhEmailTxnCta({scope:') + 46).indexOf('personal') > 0);
t('reusing Widget A chrome, not a second design',
  /class="cf-cta"/.test(ptab) && /class="cc-row"/.test(ptab));
t('with the same badge off the same count', /window\.fhStagedCount/.test(ptab));

const rv2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');
t('the router accepts a preset', /fhEmailTxnCta = async function \(preset\)/.test(rv2));
t('and applies it through the guarded setter, not localStorage directly',
  /window\.csvSetScope\(preset\.scope\)/.test(rv2));
t('a promote refreshes BOTH badges, so neither goes stale',
  /renderCashflowEmailCta[\s\S]{0,260}renderPersonal\(\)/.test(rv2));

console.log('\n-- pre-scoping cannot force a locked ledger --');
store = {}; locked();
t('csvSetScope refuses personal while locked', csvSetScope('personal') === false);
t('and persists nothing', store[CSV_SCOPE_KEY] === undefined);
unlocked();
t('but takes it when unlocked', csvSetScope('personal') === true && csvStagedScope() === 'personal');

console.log('\n-- the chip un-disables itself when the ledger becomes ready --');
const pers = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '19-personal.js'), 'utf8');
const setState = pers.slice(pers.indexOf('function _setState('), pers.indexOf('function _setState(') + 600);
t('a personal state change re-renders the staged review',
  /renderCsvReview\(\)/.test(setState));
t('and only when the STAGED review is on screen, never a file import',
  /csvStagedMode && window\.csvReview/.test(setState));

console.log('\n-- the promote path splits ONE press across both ledgers --');
const rv = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '72-txn-review.js'), 'utf8');
const promote = rv.slice(rv.indexOf('window.fhPromoteStaged'));
t('rows are partitioned by their own scope, not one batch flag',
  /csvRowScope\(c\) === 'personal'/.test(promote));
t('personal rows go to fhPersonalAddExpense', /fhPersonalAddExpense\(/.test(promote));
t('family rows still go to csvPromote', /await csvPromote\(theirs\)/.test(promote));
t('personal writes happen BEFORE csvPromote, which empties csvReview.ready',
  promote.indexOf('fhPersonalAddExpense') < promote.indexOf('await csvPromote(theirs)'));
t('a failed personal row throws before ANY family write or retirement',
  promote.indexOf('personal write failed') < promote.indexOf('await csvPromote(theirs)') &&
  promote.indexOf('personal write failed') < promote.indexOf('_stagedRetiredAdd('));
t('space_id is never set on a bank-sourced personal row (private, no un-share)',
  !/space_id\s*:/.test(promote));

console.log('\n-- the row says where it is going without being opened --');
const ui2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '56-csv-import-ui.js'), 'utf8');
t('a collapsed private row is marked', /bc-scope/.test(ui2));
t('and only the private one — family is the default, not a badge',
  /csvRowScope\(c\)==='personal'\)\s*\?/.test(ui2));
t('a private row hides "Ai trả" — one member, no split',
  /!\(csvStagedMode && csvRowScope\(c\)==='personal'\)/.test(ui2));
t('switching destination reads the editor first, so edits are not lost',
  /csvReadEditor\(c\);\s*\n\s*c\._scope = v;/.test(ui2));
t('the summary reports the MIX rather than one label', /csvScopeSummary/.test(ui2));

console.log('\n' + (fail ? '  ' + fail + ' FAILED' : '  all ' + pass + ' passed') + ' (' + (pass + fail) + ' assertions)\n');
process.exit(fail ? 1 : 0);
