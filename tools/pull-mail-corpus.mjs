#!/usr/bin/env node
// Pulls the OWNER'S OWN bank mail to this machine, for the email-reading-v2
// scoreboard (docs/specs/email-reading-v2-spec.md §13).
//
// Why a local pull and not mailbox-dryrun: the scoreboard has to replay the
// same mail through the reader over and over while the reader changes, with
// model calls off. That needs the raw MIME, which the worker never stores and
// the dry-run never returns.
//
// WHAT LEAVES THIS MACHINE: nothing. It reads Gmail with the read-only token
// `tools/gmail-oauth-probe.js connect` saved, and writes files under
// research/statements/mail-corpus/ in the MAIN checkout, a directory that is
// already git-ignored there (.gitignore: research/statements/). The repo is
// public and Vercel serves its root, so real mail must never sit anywhere git
// could pick it up. The script refuses to run if git does not ignore its
// output directory.
//
// Usage (from anywhere):
//   node tools/pull-mail-corpus.mjs                 # 365 days, registry senders + receipt domains
//   node tools/pull-mail-corpus.mjs --days 90
//   node tools/pull-mail-corpus.mjs --max 500       # stop after N new messages (a smoke test)
//
// Resumable: a message already on disk is skipped, so re-running only fetches
// what is new. One gzip file per message (Gmail's `format=full` JSON, headers
// and MIME parts intact) plus index.jsonl (id, date, from, subject, size).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The token and the OAuth client live in the MAIN checkout, wherever this
// script is run from (it may be run from a worktree).
const MAIN = process.env.FH_MAIN_CHECKOUT || '/Users/hiencao/Documents/ClaudeHC/familyhub';
const STORE = path.join(MAIN, '.gmail-probe.json');
const OUT = path.join(MAIN, 'research', 'statements', 'mail-corpus');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const DAYS = Math.max(1, Math.min(365, Number(flag('days', 365)) || 365));
const MAX = Number(flag('max', 0)) || 0;
const LANES = 4; // messages.get is 5 quota units. Gmail's per-user limit bites well below its documented 250 units/s: 12 lanes lost 539 of 950 to it

function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env.local', '.env']) {
    const p = path.join(MAIN, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

function die(msg) { console.error('\n' + msg + '\n'); process.exit(2); }

function assertIgnored() {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    execFileSync('git', ['-C', MAIN, 'check-ignore', '-q', path.join(OUT, 'probe.json.gz')]);
  } catch {
    die('Refusing to run: git does NOT ignore ' + OUT + '.\nReal mail must never be committable. Add the directory to .gitignore first.');
  }
}

async function accessToken(env, refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) die('Google refused the saved token (' + r.status + ' ' + (j.error || '') + '). Run: node tools/gmail-oauth-probe.js connect');
  return j.access_token;
}

async function gmail(token, pathAndQuery, tries = 6) {
  for (let i = 0; ; i++) {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + pathAndQuery, {
      headers: { authorization: 'Bearer ' + token },
    });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    // Gmail reports its per-user rate limit as 403 rateLimitExceeded, not 429.
    // A 403 for any other reason (a revoked scope) must still fail loudly.
    const limited = r.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(await r.clone().text().catch(() => ''));
    if ((r.status === 429 || limited || r.status >= 500) && i < tries) {
      await new Promise((res) => setTimeout(res, 800 * 2 ** i));
      continue;
    }
    throw new Error('gmail ' + r.status + ' on ' + pathAndQuery.split('?')[0]);
  }
}

async function listIds(token, q) {
  const ids = [];
  let pageToken = '';
  do {
    const j = await gmail(token, 'messages?maxResults=500&q=' + encodeURIComponent(q) + (pageToken ? '&pageToken=' + pageToken : ''));
    for (const m of (j && j.messages) || []) ids.push(m.id);
    pageToken = (j && j.nextPageToken) || '';
  } while (pageToken);
  return ids;
}

const header = (msg, name) => {
  const h = ((msg.payload && msg.payload.headers) || []).find((x) => x.name.toLowerCase() === name);
  return h ? h.value : '';
};

async function main() {
  assertIgnored();
  if (!fs.existsSync(STORE)) die('No saved token at ' + STORE + '. Run: node tools/gmail-oauth-probe.js connect');
  const env = loadEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) die('Missing GOOGLE_OAUTH_CLIENT_ID / _SECRET in ' + path.join(MAIN, '.env.local'));
  const token = await accessToken(env, JSON.parse(fs.readFileSync(STORE, 'utf8')).refresh_token);

  // The SAME sender registry the worker reads, so the corpus is what production
  // would list; receipts are a second query because the worker deliberately
  // keeps them out of its own (wave 2 of the spec).
  const senders = await import(path.join(HERE, '..', 'supabase', 'functions', '_shared', 'mailbox', 'senders.mjs'));
  const queries = [{ name: 'registry', q: senders.inboxQuery(DAYS) }];
  const receiptDomains = senders.RECEIPT_DOMAINS || (senders.RECEIPTS ? Object.values(senders.RECEIPTS).flat() : []);
  if (receiptDomains.length) {
    queries.push({ name: 'receipts', q: '(' + receiptDomains.map((d) => 'from:' + d).join(' OR ') + ') newer_than:' + DAYS + 'd' });
  }

  const seen = new Set();
  const todo = [];
  for (const { name, q } of queries) {
    const ids = await listIds(token, q);
    let fresh = 0;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (fs.existsSync(path.join(OUT, id + '.json.gz'))) continue;
      todo.push({ id, lane: name });
      fresh++;
    }
    console.log(`  ${name}: ${ids.length} listed, ${fresh} not on disk yet`);
  }
  const work = MAX ? todo.slice(0, MAX) : todo;
  console.log(`  fetching ${work.length} message(s) into ${OUT}`);

  const index = fs.createWriteStream(path.join(OUT, 'index.jsonl'), { flags: 'a' });
  let done = 0, bytes = 0, failed = 0;
  let next = 0;
  async function lane() {
    while (next < work.length) {
      const { id, lane: from } = work[next++];
      try {
        const msg = await gmail(token, 'messages/' + id + '?format=full');
        if (!msg) continue; // deleted between list and get
        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(msg)));
        fs.writeFileSync(path.join(OUT, id + '.json.gz'), gz, { mode: 0o600 });
        bytes += gz.length;
        index.write(JSON.stringify({
          id, query: from, internalDate: Number(msg.internalDate) || null,
          from: header(msg, 'from'), subject: header(msg, 'subject'),
          sizeEstimate: msg.sizeEstimate || null, labelIds: msg.labelIds || [],
        }) + '\n');
      } catch (e) {
        failed++;
        console.error('   ! ' + id + ' ' + e.message);
      }
      if (++done % 100 === 0) console.log(`   ${done}/${work.length}  (${(bytes / 1e6).toFixed(1)} MB on disk)`);
    }
  }
  await Promise.all(Array.from({ length: LANES }, lane));
  index.end();
  console.log(`\nDone: ${done - failed} saved, ${failed} failed, ${(bytes / 1e6).toFixed(1)} MB. Re-run to fetch anything that failed.`);
}

main().catch((e) => die(String(e && e.stack || e)));
