#!/usr/bin/env node
/* We own getting someone to Google's consent screen; the backend takes over at
 * the callback. This pins the URL we send them to, because every mistake in it
 * fails at Google with a message the person cannot act on:
 *
 *   - a wrong redirect_uri  -> redirect_uri_mismatch, before they see anything
 *   - a missing access_type -> no refresh token, so background sync dies quietly
 *     the same afternoon while the grant still looks fine
 *   - a lost state          -> the callback cannot tell whose ledger this is
 *
 * It also pins that the CTA can never strand someone on "Đang mở Google…", which
 * is the bug that started this file.
 *
 * `node tools/autotxn-connect.test.js`
 *
 * The real code is extracted from 74-autotxn-ui.js rather than copied.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'js-data', '74-autotxn-ui.js');
const MBX = path.join(__dirname, '..', 'src', 'js-data', '71-mailbox-ui.js');
const src = fs.readFileSync(SRC, 'utf8');
const mbx = fs.readFileSync(MBX, 'utf8');
for (const name of ['_atxConsentUrl', 'window.fhAutoTxnGrant', '_atxNavigate']) {
  if (src.indexOf(name) < 0) { console.error('FAIL: ' + name + ' missing from ' + SRC); process.exit(1); }
}
const svg = mbx.slice(mbx.indexOf('const _MBX_SVG'), mbx.indexOf('const _mbxGlyph'));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };
/* `FHTest Web` in the fhtest project (number 860668973723) — the same client
   sign-in uses. The client that ISSUES the code must be the one that EXCHANGES
   it, so the backend's GOOGLE_OAUTH_CLIENT_ID/_SECRET must be this client's too.
   Mismatch it and Google refuses with invalid_grant at the token exchange, after
   the person has already pressed Allow. Pinned here so a stray env value cannot
   quietly point the consent screen at a client this project does not own. */
const CLIENT = '860668973723-ud2mbr4kj9nb41elbkvlp3lt5fibpf8v.apps.googleusercontent.com';
const BUSY = 'Đang mở Google…';

async function run(o) {
  o = o || {};
  const parent = {}; const btn = { id: 'atx-go', disabled: false, textContent: 'go', parentNode: parent };
  parent.replaceChild = () => { parent.swapped = true; btn.parentNode = null; };
  let live = btn, modal = null;
  const toasts = [], nav = { to: null };
  const ctx = {
    _fhSheet: () => {}, _fhModal: (m) => { modal = m; }, _esc: String, _escAttr: String, _rpc: async () => null,
    sb: { auth: { getSession: async () => ({ data: { session: null } }) } },
    GOOGLE_CLIENT_ID: CLIENT,
    document: { getElementById: (id) => (id === 'atx-go' ? live : (id === 'atx-email' ? { value: o.typed || '' } : null)),
                createElement: () => ({}) },
    history: { replaceState() {} },
    location: { origin: 'https://fhtest.vercel.app', search: '', pathname: '/', hash: '',
                href: 'https://fhtest.vercel.app/',
                assign: (u) => { nav.to = u; if (!o.refuseNav) live = null; } },
    URLSearchParams, Date, setTimeout, clearTimeout, btoa, unescape, encodeURIComponent,
    console: { warn() {} }, L: (vi) => vi,
    window: { FAM: { user: { email: 'thu.trang@gmail.com' } },
              DB: o.noMember ? {} : { ownerMemberId: 'mem-abc-123' },
              fhUser: { id: 'usr-999' }, toast: (m) => toasts.push(m) },
  };
  ctx.window.location = ctx.location;
  const api = new Function(...Object.keys(ctx),
    '"use strict";' + svg + '\nconst _mbxGlyph=(k)=>_MBX_SVG[k]||"";\n' + src + '\nreturn window;'
  )(...Object.values(ctx));
  if (o.viaForm) { api.fhAutoTxnEmailSheet(); try { await modal.save(); } catch (e) { toasts.push(e.fhMsg || e.message); } }
  else { await api.fhAutoTxnGrant(); }
  await new Promise((r) => setTimeout(r, o.settle || 30));
  return { nav, toasts, btn, linkFallback: !!parent.swapped };
}
const q = (u, k) => new URL(u).searchParams.get(k);

(async () => {
  console.log('\n-- the consent URL Google is handed --');
  const a = await run({});
  t('goes to Google’s auth endpoint', a.nav.to && a.nav.to.indexOf('https://accounts.google.com/o/oauth2/v2/auth?') === 0, String(a.nav.to));
  t('carries the client the fhtest project owns, not one from another GCP project',
    q(a.nav.to, 'client_id') === CLIENT, q(a.nav.to, 'client_id'));
  t('asks for a code, not a token', q(a.nav.to, 'response_type') === 'code');
  t('requests gmail.readonly and nothing else',
    q(a.nav.to, 'scope') === 'https://www.googleapis.com/auth/gmail.readonly' &&
    q(a.nav.to, 'include_granted_scopes') === 'false', q(a.nav.to, 'scope'));
  /* Pinned, NOT derived from the origin: Google matches redirect_uri literally,
     and Vercel gives every preview deploy its own hostname. The harness serves
     the app from a different origin on purpose, so a regression back to
     location.origin fails here instead of on someone's phone. */
  t('the redirect_uri is the pinned one registered with Google, NOT the origin\n         the harness served the app from',
    q(a.nav.to, 'redirect_uri') === 'https://fhtest-opal.vercel.app/api/gmail-callback', q(a.nav.to, 'redirect_uri'));

  console.log('\n-- the two params a refresh token depends on --');
  t('access_type=offline', q(a.nav.to, 'access_type') === 'offline');
  t('prompt asks for consent (no fresh consent, no refresh token)', /\bconsent\b/.test(q(a.nav.to, 'prompt')), q(a.nav.to, 'prompt'));
  t('prompt ALSO forces the account chooser, because login_hint alone loses to an\n         existing Safari session and silently grants the wrong mailbox',
    /\bselect_account\b/.test(q(a.nav.to, 'prompt')), q(a.nav.to, 'prompt'));

  console.log('\n-- state tells the callback whose ledger this is --');
  {
    const raw = q(a.nav.to, 'state');
    let dec = null;
    try { dec = JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) {}
    t('it decodes', !!dec, String(raw));
    t('and names the member', dec && dec.mid === 'mem-abc-123', JSON.stringify(dec));
    t('and the user', dec && dec.uid === 'usr-999', JSON.stringify(dec));
    t('and is versioned, so its shape can change safely', dec && dec.v === 1);
  }
  t('no PKCE: the backend is confidential and holds the secret', !q(a.nav.to, 'code_challenge'));

  console.log('\n-- login_hint: a hint when we have one, absent when we do not --');
  t('the sign-in address is hinted', q(a.nav.to, 'login_hint') === 'thu.trang@gmail.com');
  {
    const r = await run({ viaForm: true, typed: 'other.person@gmail.com' });
    t('a typed address is hinted instead', q(r.nav.to, 'login_hint') === 'other.person@gmail.com', String(r.nav.to));
  }
  {
    const r = await run({ viaForm: true, typed: '' });
    t('blank sends NO hint, so Google offers its picker', q(r.nav.to, 'login_hint') === null, String(q(r.nav.to, 'login_hint')));
  }
  {
    const r = await run({ viaForm: true, typed: 'not-an-email' });
    t('junk is refused before we leave', r.nav.to === null && r.toasts.length === 1, String(r.nav.to));
  }

  console.log('\n-- the CTA can never stick on "Đang mở Google…" --');
  {
    const r = await run({ noMember: true });
    t('no member id: it says so and frees the button',
      r.nav.to === null && r.toasts.length === 1 && r.btn.textContent !== BUSY && !r.btn.disabled,
      JSON.stringify(r.btn.textContent));
  }
  {
    const r = await run({ refuseNav: true, settle: 1700 });
    t('a refused navigation (installed PWA) becomes a real link to tap', r.linkFallback === true);
  }

  console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
  process.exit(fail ? 1 : 0);
})();
