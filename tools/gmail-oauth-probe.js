#!/usr/bin/env node
// The decisive experiment, as one command.
//
// Answers the question everything else waits on
// (pipeline/OAUTH-COMPLIANCE-FINDINGS.md §2):
//
//   Can a PUBLISHED-but-UNVERIFIED app actually obtain gmail.readonly, and do
//   its refresh tokens survive past 7 days?
//
//   Yes → a 100-user private beta runs with no CASA, no assessment invoice and
//         no six-week wait. Everything proceeds now.
//   No  → nothing ships until verification completes, and the plan is on a
//         ~6-week clock.
//
// Usage:
//   node tools/gmail-oauth-probe.js connect   # consent once, save the token
//   node tools/gmail-oauth-probe.js check     # re-run any day; THE day-8 test
//   node tools/gmail-oauth-probe.js read      # prove a real bank email is readable
//
// Needs, in the environment or a .env.local next to this repo:
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
//
// The OAuth client must allow a loopback redirect. Easiest: create it as a
// "Desktop app" client — those accept http://127.0.0.1:<any port> with no
// redirect registration at all. A Web client works too if you register
// http://127.0.0.1:8737/callback exactly.
//
// NOTE (2026-08-22): the app's own consent flow uses `FHTest Web`
// (860668973723-…) in the `fhtest` project. This probe is a SEPARATE, local
// journey — it is not "the app's token". It exists to put a real access token in
// your hands for testing, which the app itself deliberately never holds: the app
// sends the code to the backend, and exchanging it needs the client secret,
// which stays server-side. If you point this at FHTest Web, register the
// loopback URI above on that client; a throwaway Desktop client avoids that.
//
// This talks to YOUR Google account and writes one file
// (.gmail-probe.json, gitignored). It touches nothing in Supabase, nothing in
// the app, and nothing in the forwarding pipeline.

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 8737;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const STORE = path.join(__dirname, '..', '.gmail-probe.json');

// ── config ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const env = Object.assign({}, process.env);
  for (const f of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const ENV = loadEnv();
const CLIENT_ID = ENV.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = ENV.GOOGLE_OAUTH_CLIENT_SECRET;

function requireCreds() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('\nMissing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.');
    console.error('Put them in .env.local, or export them, then run again.');
    console.error('Create the client at: https://console.cloud.google.com/auth/clients\n');
    process.exit(2);
  }
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const readStore = () => (fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : null);
const writeStore = (o) => fs.writeFileSync(STORE, JSON.stringify(o, null, 2) + '\n', { mode: 0o600 });

// ── connect ─────────────────────────────────────────────────────────────────

async function connect() {
  requireCreds();
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(12));

  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',          // without this a re-grant returns no refresh token
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  console.log('\n── Step 1: consent ─────────────────────────────────────────');
  console.log('\nOpening your browser. If it does not open, paste this:\n');
  console.log(url + '\n');
  console.log('WHAT TO WATCH FOR — this is the actual experiment:');
  console.log('  • "Google hasn\'t verified this app" → Advanced → Go to (unsafe)');
  console.log('    → consent completes  ......................  THE PATH EXISTS');
  console.log('  • blocked outright, or the scope is stripped');
  console.log('    ..........................  a beta needs verification first\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const err = u.searchParams.get('error');
      const got = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem;max-width:32rem">
        <h2>${err ? 'Consent refused' : 'Connected'}</h2>
        <p>${err ? 'Google said: ' + err : 'You can close this tab and go back to the terminal.'}</p></body>`);
      server.close();
      if (u.searchParams.get('state') !== state) return reject(new Error('state mismatch'));
      if (err) return reject(new Error('consent refused: ' + err));
      if (!got) return reject(new Error('no code returned'));
      resolve(got);
    });
    server.listen(PORT, '127.0.0.1', () => {
      execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
    });
    setTimeout(() => { server.close(); reject(new Error('timed out waiting for consent')); }, 5 * 60000);
  });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: verifier,
    }).toString(),
  });
  const tok = await r.json();
  if (!r.ok) { console.error('\nToken exchange failed:', JSON.stringify(tok, null, 2)); process.exit(1); }

  console.log('── Step 2: what Google granted ─────────────────────────────\n');
  console.log('  scope granted   :', tok.scope || '(none)');
  console.log('  refresh token   :', tok.refresh_token ? 'YES' : 'NO  ← without this there is no background sync');
  console.log('  access expires  :', tok.expires_in, 'seconds\n');

  if (!tok.refresh_token) {
    console.error('No refresh token. Re-run after removing the app at');
    console.error('https://myaccount.google.com/permissions (a re-grant reuses the old one).\n');
    process.exit(1);
  }
  if (String(tok.scope || '').indexOf(SCOPE) === -1) {
    console.error('The granted scope is NOT gmail.readonly. That is the answer: the');
    console.error('unverified path does not carry restricted scopes.\n');
    process.exit(1);
  }

  writeStore({
    refresh_token: tok.refresh_token,
    scope: tok.scope,
    connected_at: new Date().toISOString(),
    note: 'Probe only. Not a product credential. Delete this file when done.',
  });

  const eight = new Date(Date.now() + 8 * 86400000);
  console.log('Saved to .gmail-probe.json (gitignored, mode 600).\n');
  console.log('── Step 3: the part that needs a calendar ──────────────────\n');
  console.log('  Consent worked and a refresh token was issued. The remaining');
  console.log('  unknown is whether it still works in 8 days.\n');
  console.log('  On or after ' + eight.toDateString() + ', run:\n');
  console.log('      node tools/gmail-oauth-probe.js check\n');
  console.log('  works    → the 7-day expiry is Testing-only. 100-user beta is ON.');
  console.log('  fails    → the expiry follows unverified status too; verification');
  console.log('             is required before any beta.\n');
}

// ── check (the day-8 test, safe to run any day) ─────────────────────────────

async function check() {
  requireCreds();
  const store = readStore();
  if (!store) { console.error('\nNo saved token. Run `connect` first.\n'); process.exit(2); }

  const ageMs = Date.now() - new Date(store.connected_at).getTime();
  const ageDays = ageMs / 86400000;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: store.refresh_token, grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await r.json();

  console.log('\n  token age :', ageDays.toFixed(1), 'days');
  console.log('  refresh   :', r.ok ? 'WORKS' : 'FAILED (' + (data.error || r.status) + ')');

  if (r.ok) {
    if (ageDays < 7) {
      console.log('\n  Inconclusive so far — the 7-day boundary has not been crossed.');
      console.log('  Run again on or after ' +
        new Date(new Date(store.connected_at).getTime() + 8 * 86400000).toDateString() + '.\n');
    } else {
      console.log('\n  ANSWER: the refresh token OUTLIVED 7 days while unverified.');
      console.log('  The 7-day expiry is tied to Testing status only.');
      console.log('  → A 100-user private beta can run with no CASA assessment.');
      console.log('  → Record this in OAUTH-COMPLIANCE-FINDINGS.md §2.\n');
    }
    return;
  }

  if (data.error === 'invalid_grant' && ageDays >= 7) {
    console.log('\n  ANSWER: the refresh token DIED. The 7-day expiry applies to');
    console.log('  unverified apps too, not just Testing status.');
    console.log('  → A beta is NOT possible before verification completes (~6 weeks).');
    console.log('  → Record this in OAUTH-COMPLIANCE-FINDINGS.md §2 and re-plan.\n');
  } else {
    console.log('\n  Failed for another reason:', JSON.stringify(data));
    console.log('  If you revoked the app in your Google account, that is expected.\n');
  }
}

// ── read (prove the whole path works on a real email) ───────────────────────

async function read() {
  requireCreds();
  const store = readStore();
  if (!store) { console.error('\nNo saved token. Run `connect` first.\n'); process.exit(2); }

  /* `read` is the only subcommand that needs the pipeline libs, and those live on
     branch bank-email-oauth, not on main — main deliberately carries the UI half
     only. `connect` and `check` are pure Node builtins and work here as-is, so
     the missing libs must not read as "the probe is broken". */
  let gmail, extract;
  try {
    gmail = require('../pipeline/lib/gmail.js');
    extract = require('../pipeline/lib/extract.js');
  } catch (e) {
    console.error('\n`read` needs pipeline/lib/, which is not on main (it is on branch');
    console.error('bank-email-oauth). `connect` and `check` work here without it.');
    console.error('To use `read`: git checkout bank-email-oauth -- pipeline/lib\n');
    process.exit(2);
  }

  const { accessToken } = await gmail.refreshAccessToken(store.refresh_token, {
    GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
  });

  // The same seed list the pipeline uses, so this proves the real query shape.
  const domains = (ENV.PROBE_DOMAINS || 'mbbank.com.vn,vietcombank.com.vn,techcombank.com.vn,tpb.com.vn,acb.com.vn,vpbank.com.vn,bidv.com.vn,vietinbank.vn,sacombank.com,vib.com.vn,momo.vn')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const q = gmail.buildProviderQuery(domains, { days: 180 });
  console.log('\n  query :', q, '\n');

  const ids = await gmail.listMessages(accessToken, q, { max: 5 });
  console.log('  found :', ids.length, 'message(s) from known bank senders in the last 180 days\n');
  if (!ids.length) {
    console.log('  Nothing to read. Either this mailbox has no bank mail, or the');
    console.log('  senders are not in the list — set PROBE_DOMAINS to override.\n');
    return;
  }

  const msg = await gmail.getMessage(accessToken, ids[0].id);
  const auth = gmail.checkDkim(msg.headers, msg.sender);
  console.log('  ── first message ──');
  console.log('  from     :', msg.sender);
  console.log('  subject  :', msg.subject);
  console.log('  dkim     :', auth.dkim, auth.reasons.length ? '(' + auth.reasons.join('; ') + ')' : '');
  console.log('  body     :', msg.body.length, 'chars decoded');
  console.log('  template :', extract.normalizeSubjectTemplate(msg.subject));

  // Show exactly what an LLM would see, so masking can be eyeballed on REAL mail.
  const masked = extract.maskForSharing('Subject: ' + msg.subject + '\n\n' + msg.body);
  console.log('\n  ── what a model would see (masked) ──\n');
  console.log(masked.text.split('\n').slice(0, 20).map((l) => '  | ' + l).join('\n'));
  console.log('\n  ' + masked.pairs.length + ' values were swapped for fakes before anything left this machine.\n');
  console.log('  Nothing was written anywhere. This is a read-only probe.\n');
}

// ── main ────────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'connect';
const fn = { connect, check, read }[cmd];
if (!fn) {
  console.error('\nUsage: node tools/gmail-oauth-probe.js [connect|check|read]\n');
  process.exit(2);
}
fn().catch((e) => { console.error('\n  ' + (e && e.message || e) + '\n'); process.exit(1); });
