#!/usr/bin/env node
/* Auto-logging does three things, and each one has a failure invisible in review:
 *
 *   connect     — the URL comes back as JSON, deliberately. A cross-origin
 *                 fetch can do nothing useful with a 302: following it makes
 *                 the browser fetch accounts.google.com, which Google refuses,
 *                 and `redirect: 'manual'` yields an opaque-redirect response
 *                 whose headers the Fetch Standard strips, so Location reads
 *                 null no matter what the server exposes. Asking for JSON
 *                 sidesteps both. A regression to reading Location would look
 *                 fine in review and fail on every device.
 *   status      — "cannot tell" must collapse to "not connected". Announcing a
 *                 confident Connected we never verified is the version that
 *                 hides a mailbox quietly failing to sync.
 *   disconnect  — destructive, so it must arm before it fires, and deleting
 *                 nothing is the state the user asked for, not an error.
 *
 * REPOINTED 2026-08-25 at our own transport (supabase/functions/mailbox-connect
 * + migration 0084). Two mechanics changed and the intent did not:
 *   - status is read STRAIGHT FROM `mailbox_grants`, not from an endpoint. 0084
 *     pairs an own-rows select policy with a column grant that omits
 *     refresh_token_enc, so a browser gets the status line and cannot ask for
 *     the credential.
 *   - disconnect calls `disconnect_my_mailbox()`, which is the consent
 *     WITHDRAWAL action: the grant, the forwarding connection and every pending
 *     staged row, in one ownership-checked transaction. Half of that is what the
 *     consent sheet promises, so a plain row delete would make the sheet untrue.
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
  const calls = [], sheets = [], toasts = [], nav = { to: null }, rpcs = [];
  const btn = { id: 'atx-off', disabled: false, textContent: OFF, parentNode: {} };
  btn.parentNode.replaceChild = () => {};
  const ctx = {
    _fhSheet: (h) => sheets.push(h), _fhModal: () => {}, _esc: String, _escAttr: String,
    SUPABASE_URL: 'https://proj.supabase.co',
    _rpc: async (fn, args) => {
      rpcs.push(fn);
      if (o.rpcFails) throw new Error('rpc boom');
      return null;
    },
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
      sb: {
        auth: { getSession: async () => (o.noSession
          ? { data: { session: null }, error: null }
          : { data: { session: { access_token: 'tok' } }, error: null }) },
        /* Enough of the PostgREST builder to be chained the way the code chains
           it. `grants` is what the table returns; `grantsError` stands in for a
           refusal, which under RLS is the shape a signed-out read takes too. */
        from: (table) => {
          calls.push('SELECT ' + table);
          const q = {
            select: () => q, eq: () => q,
            limit: () => Promise.resolve(
              o.grantsError ? { data: null, error: { message: 'nope' } }
                            : { data: o.grants || [], error: null }),
          };
          return q;
        },
      },
    },
  };
  ctx.window.location = ctx.location;
  ctx.sb = ctx.window.sb;
  const api = new Function(...Object.keys(ctx), '"use strict";' + prelude + '\n' + src + '\nreturn window;')(...Object.values(ctx));
  return { api, calls, sheets, toasts, nav, btn, rpcs };
}
const ok = (json, headers) => ({ status: 200, json: json, headers: headers || {} });

(async () => {
  console.log('\n-- connect: the URL comes from the API, not from us --');
  const GURL = 'https://accounts.google.com/o/oauth2/v2/auth?x=1';
  {
    const m = make({ routes: { 'GET /authorize': ok({ url: GURL }),
                               } });
    await m.api.fhAutoTxnGrant();
    t('it asks our own authorize endpoint', m.calls.some((c) => /GET .*\/mailbox-connect\/authorize/.test(c)), m.calls.join(' | '));
    t('and takes the URL from the JSON body', m.nav.to === GURL, String(m.nav.to));
    t('carrying returnTo so they land back where they were',
      m.calls.some((c) => c.indexOf('returnTo=') >= 0), m.calls.join(' | '));
    t('and login_hint for the sign-in address',
      m.calls.some((c) => c.indexOf('login_hint=me%40gmail.com') >= 0), m.calls.join(' | '));
  }
  {
    // A 200 whose body carries no url. Navigating anyway would send them nowhere.
    const m = make({ routes: { 'GET /authorize': ok({ ok: true }),
                               } });
    await m.api.fhAutoTxnGrant();
    t('a body with no url does NOT navigate', m.nav.to === null, String(m.nav.to));
    t('  ...and says so instead of failing silently', m.toasts.length === 1, JSON.stringify(m.toasts));
  }
  {
    // The regression guard: Location must never become the source again.
    const m = make({ routes: { 'GET /authorize': ok(null, { Location: GURL }),
                               } });
    await m.api.fhAutoTxnGrant();
    t('a Location header is NOT used as the source (it is unreadable cross-origin)',
      m.nav.to === null, String(m.nav.to));
  }
  {
    const m = make({ routes: { 'GET /authorize': { status: 401, ok: false, headers: { get: () => null } },
                               } });
    await m.api.fhAutoTxnGrant();
    t('a 401 asks them to sign in again', /đăng nhập/i.test(m.toasts[0] || ''), JSON.stringify(m.toasts));
  }

  console.log('\n-- status: only an answer we actually verified says "connected" --');
  {
    const m = make({ grants: [{ id: 'g1', provider: 'google', email: 'me@gmail.com', needs_reauth: false }] });
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    t('a real connection swaps the offer for the status screen',
      m.sheets.some((h) => h.indexOf('Đang tự động ghi') >= 0), 'sheets=' + m.sheets.length);
    t('and the status screen carries the off-switch',
      m.sheets.some((h) => h.indexOf(OFF) >= 0));
  }
  for (const [name, opts] of [
    ['no grant at all', { grants: [] }],
    ['the read refusing', { grantsError: true }],
    /* Signed out reads as no rows rather than as an error: the select policy
       keys on auth.uid(), so RLS simply returns nothing. Same screen either
       way, which is the point. */
    ['no session (RLS returns nothing)', { noSession: true, grants: [] }],
  ]) {
    const m = make(opts);
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    t(name + ' → the offer, never a claimed "connected"',
      !m.sheets.some((h) => h.indexOf('Đang tự động ghi') >= 0), 'sheets=' + m.sheets.length);
  }
  {
    const m = make({ grants: [{ id: 'g1', provider: 'google', email: 'me@gmail.com', needs_reauth: true }] });
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    /* A token dies every 7 days while the OAuth app is in Testing status, so a
       stale grant is routine. It must not read as a healthy connection. */
    t('a grant needing re-consent is surfaced, not shown as healthy',
      m.sheets.length > 0 && !/Đang tự động ghi[^]*Đang tự động ghi/.test(m.sheets.join('')),
      'sheets=' + m.sheets.length);
  }
  {
    const m = make({ grants: [{ id: 'g1', provider: 'google', email: 'me@gmail.com', needs_reauth: false }] });
    m.api.fhAutoTxnSheet();
    await new Promise((r) => setTimeout(r, 10));
    t('the status read never asks for the credential column',
      !m.calls.some((c) => c.indexOf('refresh_token') >= 0), m.calls.join(' | '));
  }

  console.log('\n-- disconnect: armed before it fires, and honest about what it did --');
  {
    const m = make({});
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('the first tap only arms', m.rpcs.length === 0 && m.btn.textContent !== OFF, m.btn.textContent);
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('the second tap withdraws consent, it does not just unlink a row',
      m.rpcs.length === 1 && m.rpcs[0] === 'disconnect_my_mailbox', m.rpcs.join(' | '));
    const last = m.sheets[m.sheets.length - 1] || '';
    t('it confirms the saved access is deleted', last.indexOf('Đã ngừng') >= 0);
    t('  ...and does NOT claim Google access was revoked too',
      last.indexOf('myaccount.google.com/permissions') >= 0 && /vẫn còn trong danh sách/.test(last),
      'deleting the grant stops us reading; only the person can revoke at Google');
  }
  {
    /* Deleting nothing is success: the RPC returns counts and never errors on a
       user with no connection, which is exactly the state they asked for. */
    const m = make({});
    await m.api.fhAutoTxnDisconnect(m.btn);
    await m.api.fhAutoTxnDisconnect(m.btn);
    t('deleting nothing is success, not something to make them read',
      (m.sheets[m.sheets.length - 1] || '').indexOf('Đã ngừng') >= 0 && m.toasts.length === 0, JSON.stringify(m.toasts));
  }
  {
    const m = make({ rpcFails: true });
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
