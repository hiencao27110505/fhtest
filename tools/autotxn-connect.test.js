#!/usr/bin/env node
/* The auto-logging CTA must never strand someone on "Đang mở Google…".
 *
 * That is the whole property here, and it is invisible in review: a handler that
 * resets on four failure paths looks identical to one that resets on all of
 * them, right up until a real phone hits the fifth. The one that shipped reset
 * on every ERROR but had no answer for a step that simply never finishes —
 * `sb.auth.getSession()` takes a lock to refresh the token, and a lock that
 * never resolves is not something a fetch abort signal can reach. The button sat
 * disabled with no toast and no way back.
 *
 * `node tools/autotxn-connect.test.js`
 *
 * The real handler is extracted from 74-autotxn-ui.js rather than copied, so
 * loosening it fails here instead of passing against a stale duplicate.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'js-data', '74-autotxn-ui.js');
const MBX = path.join(__dirname, '..', 'src', 'js-data', '71-mailbox-ui.js');
const src = fs.readFileSync(SRC, 'utf8');
const mbx = fs.readFileSync(MBX, 'utf8');
if (src.indexOf('window.fhAutoTxnGrant') < 0) {
  console.error('FAIL: fhAutoTxnGrant not found in ' + SRC + ' — did it get renamed?');
  process.exit(1);
}
const svg = mbx.slice(mbx.indexOf('const _MBX_SVG'), mbx.indexOf('const _mbxGlyph'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const BUSY = 'Đang mở Google…';

/* One run of the handler against a given fetch, with the DOM, auth and
   navigation it touches faked just deeply enough to observe the outcome. */
async function run(fetchImpl, opts) {
  opts = opts || {};
  const parent = { children: [] };
  const btn = { id: 'atx-go', disabled: false, textContent: 'go', parentNode: parent };
  parent.replaceChild = (a) => { parent.swapped = a; btn.parentNode = null; };
  let live = btn;
  const toasts = [], nav = { to: null };
  const ctx = {
    _fhSheet: () => {}, _esc: String, _escAttr: String, _rpc: async () => null,
    sb: { auth: { getSession: opts.hangAuth ? () => new Promise(() => {})
                                            : async () => ({ data: { session: { access_token: 't' } } }) } },
    document: { getElementById: (id) => (id === 'atx-go' ? live : null),
                createElement: () => ({}) },
    history: { replaceState() {} },
    location: { search: '', pathname: '/', hash: '',
                assign: (u) => { nav.to = u; if (!opts.refuseNav) live = null; } },
    URLSearchParams, Date, setTimeout, clearTimeout, AbortController,
    console: { warn() {} }, fetch: fetchImpl, L: (vi) => vi,
    window: { FAM: { user: { email: 'a@gmail.com' } }, DB: { ownerMemberId: 'm1', _hydrated: true },
              fhUser: {}, toast: (m) => toasts.push(m) },
  };
  ctx.window.location = ctx.location;
  const api = new Function(...Object.keys(ctx),
    '"use strict";' + svg + '\nconst _mbxGlyph=(k)=>_MBX_SVG[k]||"";\n' + src + '\nreturn window;'
  )(...Object.values(ctx));

  await Promise.race([api.fhAutoTxnGrant(), new Promise((r) => setTimeout(r, opts.wait || 18000))]);
  await new Promise((r) => setTimeout(r, 1700));           // let the navigation watchdog fire
  return { btn, toasts, nav, linkFallback: !!parent.swapped };
}

const json = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, text: async () => body });
const settles = (r) => !(r.btn.textContent === BUSY && r.btn.disabled) || !!r.nav.to;

(async () => {
  console.log('\n-- every failure path releases the button and says something --');
  for (const [name, impl] of [
    ['a 404 (endpoint not deployed yet)', json(404, '<!doctype html>')],
    ['a 200 of HTML (SPA fallback served)', json(200, '<!doctype html><html>')],
    ['a 500 carrying a JSON error', json(500, '{"error":"connect_failed"}')],
    ['a 200 of valid JSON with no url', json(200, '{"ok":true}')],
    ['the network refusing outright', async () => { throw new TypeError('Failed to fetch'); }],
  ]) {
    const r = await run(impl);
    t(name, settles(r) && r.toasts.length === 1, 'btn=' + JSON.stringify(r.btn.textContent) + ' toasts=' + r.toasts.length);
  }

  console.log('\n-- ...including the ones that never finish, which is the regression --');
  {
    const r = await run(() => new Promise(() => {}), { wait: 16500 });
    t('a request that hangs past the deadline', settles(r) && r.toasts.length === 1, JSON.stringify(r.btn.textContent));
  }
  {
    const r = await run(json(200, '{}'), { hangAuth: true, wait: 16500 });
    t('a getSession that never resolves', settles(r) && r.toasts.length === 1, JSON.stringify(r.btn.textContent));
    t('  ...and an abort signal alone would NOT have caught it',
      /Promise\.race\(\[\s*attempt\s*,\s*deadline\s*\]\)/.test(src),
      'the deadline must race the whole sequence, not just abort the fetch');
  }

  console.log('\n-- a URL means we leave, and we notice if the browser will not --');
  {
    const r = await run(json(200, '{"url":"https://accounts.google.com/o/oauth2/v2/auth?x=1"}'));
    t('it navigates to the consent URL', r.nav.to === 'https://accounts.google.com/o/oauth2/v2/auth?x=1', String(r.nav.to));
    t('and stays quiet while doing it', r.toasts.length === 0, JSON.stringify(r.toasts));
    t('with no pointless link fallback', r.linkFallback === false);
  }
  {
    const r = await run(json(200, '{"url":"https://accounts.google.com/o/oauth2/v2/auth?x=1"}'), { refuseNav: true });
    t('a refused navigation (installed PWA) is caught', r.linkFallback === true);
    t('  ...and becomes a real link to tap', settles(r));
  }

  console.log('\n-- the address form and the offer CTA share one contract --');
  {
    t('there is exactly one fetch of /api/gmail-connect',
      (src.match(/fetch\('\/api\/gmail-connect'/g) || []).length === 1,
      'found ' + (src.match(/fetch\('\/api\/gmail-connect'/g) || []).length);
    t('and the form modal routes through it', /_atxConnect\(\{ email: typed/.test(src));
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})();
