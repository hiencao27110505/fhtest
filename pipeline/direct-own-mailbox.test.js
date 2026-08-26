#!/usr/bin/env node
/* It reads the USER'S OWN mailbox. Never the shared forwarding inbox.
 * `node pipeline/direct-own-mailbox.test.js`
 *
 * The two transports look alike from a distance and are opposites underneath:
 *
 *   forwarding   the user points Gmail at `txn+<tag>@<our inbox>`; the Apps
 *                Script reads OUR mailbox and works out whose mail it is from a
 *                `+tag`, because `To:` is typed text and can name anyone
 *   direct read  we hold an OAuth grant on THEIR mailbox and read it as them;
 *                ownership is proven by the grant, so there is no tag, no
 *                routing table and no unroutable-mail limbo
 *
 * Mixing them up is not a compile error. Every failure is a plausible-looking
 * one: a `to:` term in the query would return nothing and read as "no bank mail
 * this week"; a hard-coded inbox address would read one household's mail into
 * another's ledger and every row would look perfectly ordinary.
 *
 * So this file asserts the boundary directly — what the query says, whose token
 * signs the request, whose mailbox the URL names, and that no forwarding
 * machinery is reachable from this transport at all.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

global.atob = b64 => Buffer.from(b64, 'base64').toString('binary');
global.btoa = s => Buffer.from(s, 'binary').toString('base64');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

const LIB = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'mailbox');
const FN = path.join(__dirname, '..', 'supabase', 'functions');

// The shared forwarding inbox, and the machinery that serves it. None of it may
// appear in this transport's code.
const FORWARDING_INBOX = 'gichisreading@gmail.com';
const FORWARDING_ONLY = [
  'mailbox_connections',   // the alias → member routing table
  'forwarding_alias',
  'get_or_create_mailbox_alias',
  'X-Forwarded-For',       // the forwarder check, meaningless without a forwarder
  'txn/inbox',             // the labels the Apps Script drives
  'txn/processed',
];

(async () => {
const senders = await import('../supabase/functions/_shared/mailbox/senders.mjs');
const gmail = await import('../supabase/functions/_shared/mailbox/gmail.mjs');
const W = await import('../supabase/functions/_shared/mailbox/worker.mjs');

console.log('\n-- the query asks for senders, never for a recipient --');
{
  const q = senders.inboxQuery(2);
  t('every term is a from:', q.split(' OR ').every(term => term.includes('from:')), q.slice(0, 80));
  // A `to:` term is the forwarding transport's shape. Here it would match
  // nothing and read as an empty mailbox.
  t('there is no to: term', !/\bto:/.test(q), q);
  t('there is no +tag anywhere in it', q.indexOf('+') === -1, q);
  t('the shared inbox is not named', q.indexOf(FORWARDING_INBOX) === -1);
  t('it names real bank domains', q.includes('from:mbbank.com.vn') && q.includes('from:vietcombank.com.vn'));
  t('and it is time-bounded, not the whole mailbox', /newer_than:\d+d/.test(q), q);
}

console.log('\n-- no forwarding machinery is reachable from this transport --');
{
  const files = fs.readdirSync(LIB).filter(f => f.endsWith('.mjs'));
  t('there are modules to check', files.length > 10, 'found ' + files.length);
  for (const f of files) {
    const src = fs.readFileSync(path.join(LIB, f), 'utf8');
    // Comments may DISCUSS the other transport — several deliberately explain
    // why a forwarding concept does not apply here, and that is the most useful
    // thing in the file for the next reader. Only code is checked.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
                    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    t(f + ': does not name the shared inbox', code.indexOf(FORWARDING_INBOX) === -1);
    for (const token of FORWARDING_ONLY) {
      t(f + ': does not use ' + token, code.indexOf(token) === -1);
    }
  }
}
{
  for (const entry of ['mailbox-sync/index.ts', 'mailbox-connect/index.ts']) {
    const src = fs.readFileSync(path.join(FN, entry), 'utf8');
    t(entry + ': does not name the shared inbox', src.indexOf(FORWARDING_INBOX) === -1);
  }
}

console.log('\n-- every Gmail call is "me", signed by that grant\'s own token --');
{
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), auth: (init && init.headers && init.headers.Authorization) || '' });
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'ACCESS-FOR-THIS-GRANT' }) };
    }
    if (String(url).includes('/messages?')) {
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ messages: [{ id: 'm1' }] }) };
    }
    return {
      ok: true, status: 200, text: async () => '{}',
      json: async () => ({ id: 'm1', payload: { headers: [], mimeType: 'text/plain', body: { data: '' } } }),
    };
  };

  const access = await gmail.accessToken('REFRESH-FOR-THIS-GRANT',
    { clientId: 'c', clientSecret: 's' }, fakeFetch);
  t('the access token is minted from that grant\'s refresh token',
    calls[0].url.includes('oauth2.googleapis.com'));

  await gmail.listMessageIds('(from:mbbank.com.vn) newer_than:2d', 10, access, fakeFetch);
  await gmail.getMessage('m1', access, fakeFetch,
    await import('../supabase/functions/_shared/mailbox/mailtext.mjs'));

  const apiCalls = calls.filter(c => c.url.includes('gmail.googleapis.com'));
  t('every Gmail call names users/me',
    apiCalls.length === 2 && apiCalls.every(c => c.url.includes('/users/me/')),
    apiCalls.map(c => c.url).join(' | '));
  // "me" is whoever the token belongs to. That is the entire mechanism by which
  // this reads the right mailbox, so the token has to be the grant's own.
  t('and carries that grant\'s access token, not a shared one',
    apiCalls.every(c => c.auth === 'Bearer ACCESS-FOR-THIS-GRANT'),
    JSON.stringify(apiCalls.map(c => c.auth)));
  t('no Gmail call names a mailbox by address',
    !apiCalls.some(c => c.url.includes('@')), apiCalls.map(c => c.url).join(' | '));
}

console.log('\n-- two mailboxes are read as two different people --');
{
  // The failure this rules out: one token, or one cached client, serving every
  // grant. Both households' mail would stage, both would look ordinary, and
  // each would be in the wrong ledger.
  const seen = [];
  const fakeFetch = async (url, init) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com')) {
      const refresh = new URLSearchParams(String(init.body)).get('refresh_token');
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'ACCESS::' + refresh }) };
    }
    seen.push((init.headers && init.headers.Authorization) || '');
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({ messages: [] }) };
  };

  for (const refresh of ['REFRESH-ALICE', 'REFRESH-BOB']) {
    const a = await gmail.accessToken(refresh, { clientId: 'c', clientSecret: 's' }, fakeFetch);
    await gmail.listMessageIds('(from:x)', 5, a, fakeFetch);
  }
  t('each mailbox is read with its own token, never a shared one',
    seen[0] === 'Bearer ACCESS::REFRESH-ALICE' && seen[1] === 'Bearer ACCESS::REFRESH-BOB',
    JSON.stringify(seen));
}

console.log('\n-- the scope is read-only, and only mail --');
{
  t('exactly one scope is requested', gmail.SCOPES.length === 1, JSON.stringify(gmail.SCOPES));
  t('and it is gmail.readonly', gmail.SCOPES[0] === 'https://www.googleapis.com/auth/gmail.readonly');
  // Nothing here sends, modifies, labels or deletes. A narrower scope than
  // readonly does not exist (gmail.metadata carries no body), so this is the
  // floor, and it is the reason the consent copy says what it says.
  const src = fs.readFileSync(path.join(LIB, 'gmail.mjs'), 'utf8');
  for (const verb of ['method: \'POST\'', 'method: \'DELETE\'', 'modify', 'trash', 'batchDelete', 'send']) {
    const inApi = src.split('\n').filter(l => l.includes(verb) && l.includes('gmail.googleapis.com'));
    t('no Gmail ' + verb + ' call exists', inApi.length === 0);
  }
}

console.log('\n-- forwarded copies in the user\'s own mailbox do not double up --');
{
  // Someone who ALSO forwards to the alias keeps the original in their own
  // mailbox; that is the one we read. The copy they sent lands in Sent, from
  // themselves, and a personal address is not in the allowlist.
  t('the original bank mail is read', !!senders.match('MB <no-reply@mbbank.com.vn>'));
  t('their own forwarded copy is not', senders.match('Me <me@gmail.com>') === null);
  t('nor is a forward from any personal address',
    senders.match('A Friend <friend@yahoo.com>') === null);
}

console.log('\n-- the window is bounded by time, never by mailbox identity --');
{
  t('a fresh mailbox looks back 2 days', W.windowDays(null, Date.now()) === 2);
  // The PROPERTY, not the number. This window is a product decision that moved
  // 90 -> 15 -> 90 inside one day; a test naming the figure fails on the
  // decision rather than on what it is meant to protect, which is that a first
  // connect reaches back further than an ordinary poll and does so once.
  t('a first connect reaches back further than a poll', W.BACKFILL_DAYS > W.POLL_DAYS);
  /* A long outage widens PAST the backfill window on purpose. Catching up on
     mail nobody read matters more than a tidy ceiling, and the run cannot lose
     what it does not reach: the cursor only advances on a finished window. */
  t('a long outage widens the catch-up rather than capping it',
    W.windowDays('2000-01-01T00:00:00Z', Date.now()) > W.BACKFILL_DAYS);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail)
                         : 'ALL ' + pass + ' assertions passed'));
process.exit(fail ? 1 : 0);
})();
