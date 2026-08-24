#!/usr/bin/env node
/* Auto-logging talks to the connections API for three things, and each one has a
 * failure that is invisible in review:
 *
 *   connect     — the authorize route answers 302, and a browser navigation
 *                 cannot carry a Bearer header, so the URL is read out of the
 *                 Location header of a `redirect: 'manual'` fetch. If that
 *                 response is ever followed instead (status 0, opaqueredirect),
 *                 there is nothing to navigate to and guessing sends someone to
 *                 the wrong place.
 *   status      — "cannot tell" must collapse to "not connected". Announcing a
 *                 confident Connected we never verified is the version that
 *                 hides a mailbox quietly failing to sync.
 *   disconnect  — destructive, so it must arm before it fires, and a 404 (there
 *                 was nothing to delete) is the state the user asked for, not an
 *                 error to make them read.
 *
 * `node tools/autotxn-connect.test.js`
 *
 * The real handlers are extracted from 74-autotxn-ui.js rather than copied.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'js-data', '74-autotxn-ui.js');
const MBX = path.join(__dirname, '..', 'src', 'js-data', '71-mailbox-ui.js');
const src = fs.readFileSync(SRC, 'utf8');
const mbx = fs.readFileSync(MBX, 'utf8');
for (const n of ['_atxConsentUrl', '_atxConnection', 'fhAutoTxnDisconnect', '_atxNavigate']) {
  if (src.indexOf(n) < 0) { console.error('FAIL: ' + n + ' missing from ' + SRC); process.exit(1); }
}
const prelude = (() => {
  const svg = mbx.slice(mbx.indexOf('const _MBX_SVG'), mbx.indexOf('const _mbxGlyph'));
  const a = mbx.indexOf('  function _mbxAssure(');
  const b = mbx.indexOf('\n  }\n', a) + 4;
  return svg + "\nconst _mbxGlyph = (k) => _MBX_SVG[k] || '';\n" + mbx.slice(a, b);
})();

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
const OFF = 'Ngừng đọc email';

/* One instance of the module with the network, DOM and session faked. `routes`
   maps "METHOD /path" to a response, so each test states only what it cares
   about. */
function make(o) {
  o = o || {};
  const calls = [], sheets = [], toasts = [], nav = { to: null };
  const btn = { id: 'atx-off', disabled: false, textContent: OFF, parentNode: {} };
  btn.parentNode.replaceChild = () => {};
  const ctx = {
    _fhSheet: (h) => sheets.push(h), _fhModal: () => {}, _esc: String, _escAttr: String,
    _rpc: async () => null,
    document: { getElementById: (id) => (id === 'atx-off' ? btn : (id === 'atx-email' ? { value: o.typed || '' } : null)),
                createElement: () => ({}) },
    history: { replaceState() {} },
    location: { origin: 'https://app.test', pathname: '/', search: '', hash: '',
                href: 'https://app.test/', assign: (u) => { nav.to = u; } },
    URLSearchParams, Date, setTimeout, clearTimeout, console: { warn() {} },
    L: (vi) => vi,
    fetch: async (url, init) => {
      const method = (init && init.method) || 'GET';
      calls.push(method + ' ' + url);
      const key = Object.keys(o.routes || {}).find((k) => {
        const [m, p] = k.split(' ');
        return m === method && url.indexOf(p) >= 0;
      });
      if (!key) throw new TypeError('Failed to fetch');
      const r = o.routes[key];
      if (typeof r === 'function') return r();
      /* Built field by field, NOT via Object.assign over the spec: assigning the
         spec last overwrites `json` (the method) with the spec's payload and
         `headers` (the getter) with a plain map, so every response silently
         throws inside the code under test. */
      const hdrs = r.headers || {};
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        headers: { get: (h) => (Object.prototype.hasOwnProperty.call(hdrs, h) ? hdrs[h] : null) },
        json: async () => r.json,
        text: async () => JSON.stringify(r.json),
      };
    },
    window: {
      FAM: { user: { email: 'me@gmail.com' } }, DB: { ownerMemberId: 'm1', _hydrated: true },
      fhUser: { id: 'u1' }, toast: (m) => toasts.push(m),
      sb: { auth: { getSession: async () => (o.noSession
        ? { data: { session: null }, error: null }
        : { data: { session: { access_token: 'tok' } }, error: null }) } },
    },
  };
  ctx.window.location = ctx.location;
  ctx.sb = ctx.window.sb;
  const api = new Function(...Object.keys(ctx), '"use strict";' + prelude + '\n' + src + '\nreturn window;')(...Object.values(ctx));
  return { api, calls, sheets, toasts, nav, btn };
}
const ok = (json, headers) => ({ status: 200, json: json, headers: headers || {} });

(async () => {
  console.log('\n-- connect: the URL comes from the API, not from us --');
  {
    const m = make({ routes: { 'GET /connections/google/authorize': ok(null, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }),
                               'GET /connections': ok([]) } });
    await m.api.fhAutoTxnGrant();
    t('it asks the API to authorize', m.calls.some((c) => /GET .*\/connections\/google\/authorize/.test(c)), m.calls.join(' | '));
    t('and navigates to the Location it answers with',
      m.nav.to === 'https://accounts.google.com/o/oauth2/v2/auth?x=1', String(m.nav.to));
    t('carrying returnTo so they land back where they were',
      m.calls.some((c) => c.indexOf('returnTo=') >= 0), m.calls.join(' | '));
    t('and login_hint for the sign-in address',
      m.calls.some((c) => c.indexOf('login_hint=me%40gmail.com') >= 0), m.calls.join(' | '));
  }
  {
    // opaqueredirect: the browser followed the 302 anyway, so there is no Location
    const m = make({ routes: { 'GET /connections/google/authorize': { status: 0, ok: false, headers: { get: () => null } },
                               'GET /connections': ok([]) } });
    await m.api.fhAutoTxnGrant();
    t('a followed redirect with no readable Location does NOT guess a URL', m.nav.to === null, String(m.nav.to));
    t('  ...and says so instead of failing silently', m.toasts.length === 1, JSON.stringify(m.toasts));
  }
  {
    const m = make({ routes: { 'GET /connections/google/authorize': { status: 401, ok: false, headers: { get: () => null } },
                               'GET /connections': ok([]) } });
    await m.api.fhAutoTxnGrant();
    t('a 401 asks them to sign in again', /đăng nhập/i.test(m.toasts[0] || ''), JSON.stringify(m.toasts));
  }

  console.log('\n-- status: only an answer we actually verified says "connected" --');
  {
    const m = make({ routes: { 'GET /connections': ok([{ provider: 'google', email: 'me@gmail.com' }]) } });
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    t('a real connection swaps the offer for the status screen',
      m.sheets.some((h) => h.indexOf('Đang tự động ghi') >= 0), 'sheets=' + m.sheets.length);
    t('and the status screen carries the off-switch',
      m.sheets.some((h) => h.indexOf(OFF) >= 0));
  }
  for (const [name, routes] of [
    ['no connections at all', { 'GET /connections': ok([]) }],
    ['a provider that is not google', { 'GET /connections': ok([{ provider: 'notion' }]) }],
    ['the API refusing (500)', { 'GET /connections': { status: 500, ok: false, headers: { get: () => null }, json: null } }],
    ['the API unreachable', {}],
  ]) {
    const m = make({ routes });
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    t(name + ' → the offer, never a claimed "connected"',
      !m.sheets.some((h) => h.indexOf('Đang tự động ghi') >= 0), 'sheets=' + m.sheets.length);
  }
  {
    const m = make({ noSession: true, routes: { 'GET /connections': ok([{ provider: 'google' }]) } });
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    t('no session → the offer, and /connections is never called',
      !m.sheets.some((h) => h.indexOf('Đang tự động ghi') >= 0) && m.calls.length === 0, m.calls.join(' | '));
  }

  console.log('\n-- disconnect: armed before it fires, and honest about what it did --');
  {
    const m = make({ routes: { 'DELETE /connections/google': ok({ disconnected: 1 }) } });
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('the first tap only arms', m.calls.length === 0 && m.btn.textContent !== OFF, m.btn.textContent);
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('the second tap sends DELETE /connections/google',
      m.calls.some((c) => c.indexOf('DELETE') === 0 && /\/connections\/google$/.test(c)), m.calls.join(' | '));
    const last = m.sheets[m.sheets.length - 1] || '';
    t('it confirms the saved access is deleted', last.indexOf('Đã ngừng') >= 0);
    t('  ...and does NOT claim Google access was revoked too',
      last.indexOf('myaccount.google.com/permissions') >= 0 && /vẫn còn trong danh sách/.test(last),
      'the API deletes the row but never revokes the grant');
  }
  {
    const m = make({ routes: { 'DELETE /connections/google': { status: 404, ok: false, headers: { get: () => null }, json: null } } });
    await m.api.fhAutoTxnDisconnect(m.btn);
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('a 404 is success: there was nothing left to delete',
      (m.sheets[m.sheets.length - 1] || '').indexOf('Đã ngừng') >= 0 && m.toasts.length === 0, JSON.stringify(m.toasts));
  }
  {
    const m = make({ routes: { 'DELETE /connections/google': { status: 500, ok: false, headers: { get: () => null }, json: null } } });
    await m.api.fhAutoTxnDisconnect(m.btn);
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('a real failure says so and gives the button back',
      m.toasts.length === 1 && m.btn.disabled === false && m.btn.textContent === OFF,
      JSON.stringify(m.btn.textContent) + ' toasts=' + m.toasts.length);
    t('  ...and does NOT claim it stopped',
      !(m.sheets[m.sheets.length - 1] || '').indexOf('Đã ngừng') >= 0 || m.sheets.length === 0);
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})();
