/* The harness the email-reading-v2 worker tests share (parking, the daily
 * wall, notices, the format-aware header pass). NOT a test: no `.test.js`, so
 * the runner does not discover it.
 *
 * Same shape as direct-notify-count.test.js: a stubbed token endpoint and
 * Gmail, a stubbed Gemini, a real seal, and an in-memory database that keeps
 * what the worker writes (staged rows, message holds, the pause row, the
 * format table, fingerprints, tallies) so a second run can be driven against
 * what the first one left behind. No real personal data anywhere.
 */
import nacl0 from 'tweetnacl';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const nacl = nacl0.default || nacl0;
export const ROOT = fileURLToPath(new URL('../supabase/functions/_shared/mailbox/', import.meta.url));
export const W  = await import(ROOT + 'worker.mjs');
export const TC = await import(ROOT + 'token-crypto.mjs');
export const L  = await import(ROOT + 'llm.mjs');

const FAM_PUB = Buffer.from(nacl.box.keyPair.fromSecretKey(new Uint8Array(crypto.randomBytes(32))).publicKey).toString('base64');
const TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const ENC_REFRESH = await TC.encryptToken('refresh-<REDACTED>', TOKEN_KEY, { subtle: crypto.webcrypto.subtle });
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const SEP = String.fromCharCode(0);   // the separator extract.mjs keys its cache with

/** worker.mjs _budget, which is not exported. */
export function budget(max) {
  let used = 0;
  return { spend: () => (used < max ? (used++, true) : false), used: () => used, left: () => max - used };
}

/** A tiny pass/fail reporter, the suite's usual one. */
export function reporter() {
  let pass = 0, fail = 0;
  const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };
  const done = () => { console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED')); process.exit(fail ? 1 : 0); };
  return { t, done };
}

/* Three mails. `table`: an MB balance-change notice the label-table tier reads
   locally. `model`: prose from a registered bank domain no free tier can read,
   so it goes to the model. `notice`: a card due reminder, likewise model-bound.
   Every id gets its own subject word so two model mails are two SHAPES. */
export function mailFor(id, kind, subjectExtra) {
  let from, subject, body;
  if (kind === 'table') {
    from = 'MB <mbebanking@mbbank.com.vn>';
    subject = 'Thong bao thong tin giao dich TK cham';
    body = ['MB TK cham', 'x5249', 'Ngay, gio giao dich', '28-08-2026 09:14:02',
      'Diem giao dich', 'GS25 NGUYEN VAN LINH', 'So tien', '-37,000 VND'].join('\n');
  } else if (kind === 'notice') {
    from = 'VIB <info@vib.com.vn>';
    subject = 'Nhac no the tin dung ' + (subjectExtra || '');
    body = 'Quy khach vui long thanh toan du no the truoc ngay 25/09. Xin cam on.';
  } else {
    from = 'VIB <info@vib.com.vn>';
    subject = 'Thong bao ' + (subjectExtra || id);
    body = 'Quy khach vua thuc hien mot giao dich. Chi tiet xem tai ung dung. Xin cam on.';
  }
  return {
    id, threadId: 'th' + id, internalDate: String(Date.now() - 60000),
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: new Date().toUTCString() },
        { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.d=' + from.replace(/.*@/, '').replace('>', '') },
      ],
      mimeType: 'text/plain',
      body: { data: b64u(body) },
    },
  };
}

/** A Gemini answer body for one transaction (no citable labels: unlearnable). */
export const TXN_ANSWER = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  mail_kind: 'transaction', is_transaction: true, amount: 120000, currency: 'VND', direction: 'debit',
  occurred_at: '2026-09-20T09:00:00+07:00', counterparty: 'Cua hang', signal: 'purchase',
}) }] } }] });
export const NOTICE_ANSWER = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  mail_kind: 'notice', is_transaction: false, signal: 'card_due',
  notice: { due_date: '2026-09-25', min_payment: 1200000, closing_debt: 8400000 },
}) }] } }] });
export const MULTI_ANSWER = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  mail_kind: 'transaction', is_transaction: true, multi: true,
}) }] } }] });
export const DAY_429 = JSON.stringify({ error: { code: 429, details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }] } });
export const MINUTE_429 = JSON.stringify({ error: { code: 429, details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }] } });

/**
 * The in-memory database. Persists across runs of one test so run 2 sees what
 * run 1 wrote. `opts.parking` false = a db from before 0146 (holds as before).
 */
export function memoryDb(opts) {
  const o = opts || {};
  const staged = new Map();          // gmail_message_id -> row
  const holds = new Map();           // msg -> { attempts, gave_up, reason, build }
  const fingerprints = new Map();
  const formatRows = new Map();
  const tallies = {};
  const calls = [];
  const pause = { until: null, reason: null };
  const budget = { spent: 0, cap: o.dailyCap ?? 1000, answers: [] };
  const key = (p, s) => p + '\n' + s;
  const db = {
    staged, holds, fingerprints, formatRows, tallies, calls, pause, budget,
    async memberById() { return { id: 'm1', family_id: 'f1', archived_at: null }; },
    async stagingPubForFamily() { return FAM_PUB; },
    async stagingPubForUser() { return FAM_PUB; },
    async providerDomains() { return ['mbbank.com.vn', 'vib.com.vn']; },
    async stagedState(ids) { return { staged: new Set(ids.filter((i) => staged.has(i))), resolved: new Map() }; },
    async alreadyStaged(ids) { return new Set(ids.filter((i) => staged.has(i))); },
    async stagedCandidates() { return []; },
    async insertStaged(row) { if (staged.has(row.gmail_message_id)) return false; staged.set(row.gmail_message_id, row); return true; },
    async recordFailure(r) { calls.push(['recordFailure', r.gmail_message_id]); },
    async markSynced(id, fields) { calls.push(['markSynced', fields]); },
    async advanceBackfill(id, fields) { calls.push(['advanceBackfill', fields]); },
    async fingerprint(s, tpl) { return fingerprints.get(s + SEP + tpl) || null; },
    async fingerprintsForSenders(list) {
      const out = new Map();
      for (const [k, v] of fingerprints) if (list.includes(k.split(SEP)[0])) out.set(k, v);
      return out;
    },
    async saveFingerprint(row) {
      const k = String(row.sender_address).toLowerCase() + SEP + row.subject_template;
      fingerprints.set(k, { ...(fingerprints.get(k) || {}), ...row });
    },
    async bumpReadTally(stage) { tallies[stage] = (tallies[stage] || 0) + 1; },
    async recordStall() {}, async clearStall() {},
    async pendingCount() {
      let n = 0;
      for (const r of staged.values()) if (r.review_status === 'pending' && (r.row_kind || 'txn') === 'txn') n++;
      return n;
    },
  };
  if (o.parking !== false) {
    Object.assign(db, {
      async recordMessageHold(grantId, msg, reason, cap, build) {
        calls.push(['recordMessageHold', msg, reason, cap]);
        const h = holds.get(msg) || { attempts: 0, gave_up: false, reason: null, build: null, at: 0 };
        h.attempts++; h.reason = reason; h.build = build; h.at = ++db._tick;
        holds.set(msg, h);
        if (h.attempts >= Math.max(1, Math.min(20, cap || 5))) { h.gave_up = true; return true; }
        return false;
      },
      async clearMessageHold(grantId, msg) { calls.push(['clearMessageHold', msg]); const h = holds.get(msg); if (h && !h.gave_up) holds.delete(msg); },
      async parkedMessages(grantId, limit) {
        return [...holds.entries()].filter(([, h]) => !h.gave_up).sort((a, b) => a[1].at - b[1].at).map(([m]) => m).slice(0, limit || 50);
      },
      async abandonedMessages() { return [...holds.entries()].filter(([, h]) => h.gave_up).map(([m]) => m); },
      async releaseReaderGiveups(build) {
        calls.push(['releaseReaderGiveups', build]);
        let n = 0;
        for (const h of holds.values()) if (h.gave_up && h.build && h.build !== build) { h.gave_up = false; h.attempts = 0; n++; }
        return n;
      },
      _tick: 0,
    });
  }
  if (o.wall !== false) {
    Object.assign(db, {
      async modelPausedUntil() { calls.push(['modelPausedUntil']); return pause.until && Date.parse(pause.until) > Date.now() ? pause.until : null; },
      async pauseModel(model, until, reason) { calls.push(['pauseModel', model, reason]); pause.until = until.toISOString ? until.toISOString() : String(until); pause.reason = reason; },
      async spendModelBudget(model, lane, n) {
        calls.push(['spendModelBudget', model, lane, n]);
        if (pause.until && Date.parse(pause.until) > Date.now()) return false;
        if (budget.spent + (n || 1) > budget.cap) return false;
        budget.spent += (n || 1); return true;
      },
    });
  }
  if (o.formats !== false) {
    /* The store's CONTRACT (formats.mjs memoryFormatStore), over the in-memory
       table; the real db.formats is pinned by format-store.test.js. */
    db.formats = {
      async get(p, s) { const r = formatRows.get(key(p, s)); return r ? r.format : null; },
      async fetch(p, s) { const r = formatRows.get(key(p, s)); return r ? r.format : null; },
      async put(f) { formatRows.set(key(f.provider, f.sig), { format: f }); return true; },
      async providerHasAny(p) { return o.providerFormats ? o.providerFormats.includes(p) : [...formatRows.keys()].some((k) => k.split('\n')[0] === p); },
    };
  }
  return db;
}

/**
 * @param {object} a
 * @param {string[]} a.queue          message ids Gmail lists, newest first
 * @param {(id:string)=>object} a.mail  id -> the Gmail message (mailFor)
 * @param {(id:string, n:number)=>{status:number, body:string}} a.llm  the model's answer to the n-th call
 */
export function makeCtx(a) {
  const banners = [];
  const model = { calls: 0, prompts: [] };
  const db = a.db || memoryDb(a.dbOpts);
  const ctx = {
    db, banners, model,
    nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle,
    dedupKey: crypto.randomBytes(32).toString('base64'),
    tokenKey: TOKEN_KEY, fromBytea: (v) => v,
    google: { clientId: 'cid', clientSecret: '<REDACTED>' },
    llm: { apiKey: a.llm ? 'test-key' : null },
    notify: async (grant, count, opts) => { banners.push({ count, backfill: !!(opts && opts.backfill) }); },
    /* runGrant expects the per-grant budget runAll mints; absent, the model
       is ungated (as in every older runGrant test). */
    budget: a.maxModelCalls != null ? budget(a.maxModelCalls) : undefined,
    classifyBudget: a.classifyBudget,
    ...(a.ctx || {}),
    fetch: async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }),
                 text: async () => '{"access_token":"at","expires_in":3600}' };
      }
      if (u.indexOf('generativelanguage.googleapis.com') >= 0) {
        model.calls++;
        try { model.prompts.push(JSON.parse(init.body)); } catch { model.prompts.push(null); }
        const r = a.llm ? a.llm(model.calls, init) : { status: 500, body: 'no model in this test' };
        return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
      }
      if (u.includes('/messages?') || u.endsWith('/messages')) {
        const list = { messages: a.queue.map((id) => ({ id })) };
        return { ok: true, status: 200, json: async () => list, text: async () => JSON.stringify(list) };
      }
      const m = u.match(/\/messages\/([^?]+)/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        ctx.fetched.push(id + (u.indexOf('format=metadata') >= 0 ? ':meta' : ':body'));
        const msg = a.mail(id);
        if (!msg) return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
        return { ok: true, status: 200, json: async () => msg, text: async () => JSON.stringify(msg) };
      }
      throw new Error('unstubbed fetch: ' + u);
    },
    fetched: [],
  };
  return ctx;
}

/** A grant whose backfill has FINISHED: the steady state. */
export const settled = (extra) => ({
  id: 'g1', user_id: 'u1', member_id: 'm1', family_id: 'f1', email: 'bf@gmail.com',
  needs_reauth: false, refresh_token_enc: ENC_REFRESH, last_synced_at: new Date().toISOString(),
  backfilled_at: '2026-08-28T00:00:00Z', backfilled_days: 90, backfill_days: 90,
  default_scope: 'family', stalled_runs: 0, reader_v: 2, ...(extra || {}),
});
