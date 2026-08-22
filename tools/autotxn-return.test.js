#!/usr/bin/env node
/* The auto-logging return leg reads a one-time outcome out of the URL and eats
 * it. Two properties matter, and neither is visible in review:
 *
 *   1. An UNRECOGNISED value must be ignored, not guessed at. The BE dev owns
 *      the redirect; if they pick different spellings, this has to degrade to
 *      silence rather than tell someone they are connected when nobody knows.
 *   2. The param must be EATEN, and eaten exactly once. A reload replaying
 *      "connected" is a lie the second time, and leaving it in the bar puts a
 *      stale outcome into history and share sheets.
 *
 * `node tools/autotxn-return.test.js`
 *
 * The real function is extracted from 74-autotxn-ui.js by name rather than
 * copied, so loosening the check there fails here instead of passing against a
 * stale duplicate.
 */
// NOT 'use strict': the eval'd declarations must land in the harness scope.
const fs = require('fs');
const path = require('path');

const SRC_FILE = path.join(__dirname, '..', 'src', 'js-data', '74-autotxn-ui.js');
const src = fs.readFileSync(SRC_FILE, 'utf8');

const start = src.indexOf('function _atxReturnState()');
const end = src.indexOf('function fhAutoTxnDone(');
if (start < 0 || end < 0) {
  console.error('FAIL: could not find _atxReturnState in ' + SRC_FILE + ' — did it get renamed?');
  process.exit(1);
}
const FN_SRC = src.slice(start, end);

let pass = 0, fail = 0;
const t = (n, ok, d) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : ''));
  ok ? pass++ : fail++;
};

/* A location + history pair with just enough surface. `url` records what the
   replaceState left behind, which is the only way to see the eat happen. */
function make(search, hash) {
  const location = { search: search, pathname: '/', hash: hash || '' };
  const history = { calls: 0, url: null, replaceState: function (a, b, u) { this.calls++; this.url = u; } };
  // eslint-disable-next-line no-eval
  const read = eval('(function(){' + FN_SRC + 'return _atxReturnState;})()');
  return { read, location, history, URLSearchParams };
}

/* The eval'd body closes over whatever `location`/`history` are in scope here,
   so each case installs its own pair before calling. */
let location, history;
function run(search, hash) {
  const m = make(search, hash);
  location = m.location; history = m.history;
  const out = m.read();
  return { out: out, history: m.history, location: m.location };
}

console.log('\n-- the three states the contract defines --');
for (const v of ['connected', 'denied', 'error']) {
  const r = run('?fh_gmail=' + v);
  t('fh_gmail=' + v + ' is read', r.out === v, JSON.stringify(r.out));
}

console.log('\n-- ...and the documented alias --');
{
  const r = run('?gmail=connected');
  t('gmail= is accepted too', r.out === 'connected', JSON.stringify(r.out));
}

console.log('\n-- anything else is ignored, never guessed at --');
const IGNORED = [
  ['no query at all', ''],
  ['an unrelated param', '?ref=email'],
  ['a value we do not define', '?fh_gmail=success'],
  ['an empty value', '?fh_gmail='],
  ['the param name as a value', '?x=fh_gmail'],
];
for (const [name, q] of IGNORED) {
  const r = run(q);
  t(name, r.out === null, JSON.stringify(r.out));
  t('  ...and nothing is rewritten', r.history.calls === 0, 'calls=' + r.history.calls);
}

console.log('\n-- the outcome is eaten on arrival --');
{
  const r = run('?fh_gmail=connected');
  t('the URL is rewritten once', r.history.calls === 1, 'calls=' + r.history.calls);
  t('and the param is gone from it', r.history.url.indexOf('fh_gmail') < 0, r.history.url);
}
{
  const r = run('?utm=x&fh_gmail=denied&ref=mail');
  t('unrelated params survive the eat', /utm=x/.test(r.history.url) && /ref=mail/.test(r.history.url), r.history.url);
  t('but the outcome does not', r.history.url.indexOf('fh_gmail') < 0, r.history.url);
}
{
  const r = run('?fh_gmail=connected', '#somewhere');
  t('the fragment is preserved', /#somewhere$/.test(r.history.url), r.history.url);
}
{
  const r = run('?fh_gmail=connected&gmail=denied');
  t('both spellings are eaten together', r.history.url.indexOf('gmail') < 0, r.history.url);
  t('and the canonical one wins', r.out === 'connected', JSON.stringify(r.out));
}

console.log('\n-- a hostile or broken URL must not throw into boot --');
{
  let threw = false;
  try {
    const m = make('?fh_gmail=connected');
    location = m.location;
    history = { replaceState: function () { throw new Error('blocked'); } };
    m.read();
  } catch (e) { threw = true; }
  t('a replaceState that throws is contained', threw === false);
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
