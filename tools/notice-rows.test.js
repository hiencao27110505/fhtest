#!/usr/bin/env node
/* A notice is never a review card.  `node tools/notice-rows.test.js`
 *
 * Card due notices and "statement ready" mail move no money. They are staged in
 * the same sealed table with the clear column row_kind = 'notice'
 * (email-reading-v2-spec §6, migration 0147). On the device that means:
 *
 *   - every reader of the pending queue leaves them out: the review list and its
 *     exact count, the badge, quick review, and the connect screen's pending
 *     count, "Vừa tìm thấy" feed and oldest-pending floor;
 *   - the client ships BEFORE the migration, so each of those reads must survive
 *     the column not existing, and must not pay a failed round trip forever;
 *   - a notice is opened with the same opener, applied QUIETLY to the one account
 *     it matches (provider + last four digits, never created), and retired
 *     through the same RPC. No match: simply retired. Unreadable: left alone.
 *
 * Real functions extracted from source by name; a fake PostgREST; synthetic data.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC72 = read('src/js-data/72-txn-review.js');
const SRC74 = read('src/js-data/74-autotxn-ui.js');
const SRC76 = read('src/js-data/76-quick-review.js');
const SRC23 = read('src/js-data/23-debts-ui.js');
const SRC57 = read('src/js-ui/57-csv-import-review.js');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}
function grab(src, header) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error('not found in source: ' + header);
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, i + 1);
}

/* A PostgREST stand-in: records every query, and answers "no such column" to any
   filter on row_kind while the migration is "not applied". */
function fakeSb(state) {
  return { from(table) {
    const q = { table, filters: [], ordered: false };
    const self = {
      select(cols, opts) { q.cols = cols; q.head = !!(opts && opts.head); return self; },
      eq(k, v) { if (q.ordered) throw new Error('filter after order'); q.filters.push(['eq', k, v]); return self; },
      is(k, v) { q.filters.push(['is', k, v]); return self; },
      gte(k, v) { q.filters.push(['gte', k, v]); return self; },
      or(expr) { if (q.ordered) throw new Error('filter after order'); q.filters.push(['or', expr]); return self; },
      order() { q.ordered = true; return self; },
      limit() { return self; },
      then(res, rej) {
        state.queries.push(q);
        const touchesKind = q.filters.some((f) => /row_kind/.test(String(f[1])));
        if (touchesKind && !state.hasColumn) return Promise.resolve({ data: null, error: { code: '42703', message: 'column email_transactions.row_kind does not exist' } }).then(res, rej);
        if (state.networkDown) return Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } }).then(res, rej);
        const wantsNotice = q.filters.some((f) => f[0] === 'eq' && f[1] === 'row_kind' && f[2] === 'notice');
        const txnOnly = q.filters.some((f) => f[0] === 'or' && /row_kind\.neq\.notice/.test(f[1]));
        const rows = state.rows.filter((r) => wantsNotice ? r.row_kind === 'notice' : (txnOnly ? r.row_kind !== 'notice' : true));
        return Promise.resolve(q.head ? { count: rows.length, data: null, error: null } : { data: rows, error: null }).then(res, rej);
      },
    };
    return self;
  } };
}
function device(state, accounts) {
  const store = {};
  const ctx = {
    console: { warn() {}, log() {} }, L: (vi) => vi,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    DB: { fid: 'fam-1', ownerMemberId: 'm1' }, fhUser: { id: 'user-1' },
    csvBaseAmt: (n) => Number(n) / 1000,
    FHCrypto: { encVal: async (k, v) => 'enc:' + Buffer.from(String(v)).toString('base64'), decVal: async (k, b) => Buffer.from(String(b).slice(4), 'base64').toString() },
    updates: [], resolved: [], renders: 0, toasts: 0,
  };
  ctx.window = ctx; ctx.sb = fakeSb(state); ctx.__store = store;
  ctx.toast = () => { ctx.toasts++; };
  ctx.renderPersonal = () => { ctx.renders++; };
  ctx.fhPersonalData = () => ({ state: 'ready', key: 'k', accounts: accounts });
  ctx.fhPersonalAccountUpdate = async (id, f) => { ctx.updates.push([id, f]); const a = accounts.find((x) => x.id === id); if (a) Object.assign(a, f); return true; };
  ctx._rpc = async (fn, args) => { ctx.resolved.push([fn, args.p_ids.slice()]); return args.p_ids.length; };
  ctx.fhPersonalStagingPrivKey = async () => 'priv'; ctx.fhStagingPrivKey = async () => 'priv';
  ctx.fhStagingOpenRow = (row) => { if (row.__locked) throw new Error('locked'); return row.__payload; };
  vm.createContext(ctx);
  vm.runInContext(grab(SRC57, 'function csvCanonicalProvider(') + '\nvar CSV_PROVIDER_NOISE = ' + SRC57.match(/var CSV_PROVIDER_NOISE = (\[[^\]]*\]);/)[1] + ';\nfunction deburr(s){ return String(s).normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D"); }', ctx);
  // TXN_REVIEW_PAGE .. fhRefreshStagedCount's neighbours: the retired list, the helper, the fetch.
  vm.runInContext(SRC72.slice(SRC72.indexOf('var TXN_REVIEW_PAGE'), SRC72.indexOf('window.fhStagedCount = 0;')), ctx);
  vm.runInContext(grab(SRC72, 'async function fhReadStagedRow('), ctx);
  vm.runInContext(SRC72.slice(SRC72.indexOf('var _fhNoticeBusy'), SRC72.indexOf('/* Which transport imported a staged row')), ctx);
  return ctx;
}
const txn = (id) => ({ id, row_kind: 'txn', sealed: 'x', occurred_at: '2026-09-01T03:00:00Z' });
const notice = (id, provider, detail, extra) => Object.assign({ id, row_kind: 'notice', sealed: 'x', staging_scope: 'personal',
  source_provider: provider, occurred_at: '2026-09-10T03:00:00Z',
  __payload: { amount: null, direction: null, raw_extracted: Object.assign({ v: 2, mail_kind: 'notice', signal: 'card_due' }, detail) } }, extra || {});

(async () => {
  console.log('the queue reads transactions only');
  {
    const state = { hasColumn: true, queries: [], rows: [txn('t1'), txn('t2'), notice('n1', 'TESTBANK', {})] };
    const ctx = device(state, []);
    const rows = await vm.runInContext('fhFetchStagedTxns()', ctx);
    ok(rows.length === 2 && rows.every((r) => r.row_kind !== 'notice'), 'fhFetchStagedTxns leaves the notice out', rows.map((r) => r.id));
    ok(ctx.fhStagedTotal === 2, 'and the total behind the badge does not count it', ctx.fhStagedTotal);
    ok(state.queries.length === 1 && state.queries[0].filters.some((f) => f[0] === 'or' && f[1] === 'row_kind.is.null,row_kind.neq.notice'),
      'one query, filtered server-side; a NULL row_kind reads as a transaction', state.queries[0].filters);
    ok(/select\('id', \{ count: 'exact', head: true \}\)\s*\.eq\('review_status', 'pending'\)\); \}\);/.test(grab(SRC72, 'async function fhFetchStagedTxns(')),
      'the exact-count follow-up goes through the same helper');
  }

  console.log('\nbefore the migration: the column does not exist');
  {
    const state = { hasColumn: false, queries: [], rows: [txn('t1'), txn('t2')] };
    const ctx = device(state, []);
    let rows = await vm.runInContext('fhFetchStagedTxns()', ctx);
    ok(rows.length === 2, 'the queue still opens, with every row (until the column exists every row is a transaction)', rows.length);
    ok(state.queries.length === 2, 'it cost one failed query, then the plain one', state.queries.length);
    rows = await vm.runInContext('fhFetchStagedTxns()', ctx);
    ok(rows.length === 2 && state.queries.length === 3, '...and only ONCE a session: the next read goes straight to the plain query', state.queries.length);
    ok((await vm.runInContext('fhNoticesApply()', ctx)) === 0 && state.queries.length === 3, 'and no notice pass is attempted while there can be no notices');

    const down = { hasColumn: true, networkDown: true, queries: [], rows: [] };
    const c2 = device(down, []);
    let threw = false;
    try { await vm.runInContext('fhFetchStagedTxns()', c2); } catch (e) { threw = true; }
    ok(threw && down.queries.length === 1, 'any OTHER error is still an error: it is not mistaken for a missing column', [threw, down.queries.length]);
  }

  console.log('\nevery other reader of the pending queue uses the same helper');
  {
    ok(/window\.fhStagedTxnOnly = fhStagedTxnOnly;/.test(SRC72), '72 exports it');
    const qr = grab(SRC76, 'async function _qrFetch(');
    ok(/window\.fhStagedTxnOnly \? window\.fhStagedTxnOnly\(ask\)/.test(qr) && /txnOnly\(window\.sb\.from\('email_transactions'\)/.test(qr), 'quick review (_qrFetch)');
    ['async function _atxPendingCount(', 'async function _atxRecentFinds(', 'async function _atxFrontier('].forEach((h) => {
      const body = grab(SRC74, h);
      ok(/_atxTxnOnly\(/.test(body) && /txnOnly\(/.test(body), 'connect screen: ' + h.replace('async function ', '').replace('(', ''));
    });
    const direct = (SRC72 + SRC74 + SRC76).split("from('email_transactions')").length - 1;
    ok(direct === 7, 'and there is no eighth reader of the table that nobody looked at (6 filtered + the notice pass itself)', direct);
  }

  console.log('\nwhich account, and what it states');
  {
    const ctx = device({ hasColumn: true, queries: [], rows: [] }, []);
    const cards = [{ id: 'card-A', kind: 'credit_card', tail: '4444', provider: 'testbank' }, { id: 'card-B', kind: 'credit_card', tail: '4444', provider: 'otherbank' },
      { id: 'dep', kind: 'deposit', tail: '8888', provider: 'testbank' }];
    ctx.__cards = cards;
    const target = (prov, x) => { ctx.__a = [prov, x]; const a = vm.runInContext('fhNoticeTarget(__a[0], __a[1], __cards)', ctx); return a ? a.id : null; };
    ok(target('TESTBANK', { card_masked: '**** 4444' }) === 'card-A', 'provider + last four digits -> that card');
    ok(target('Test Bank', { account_masked: '4444' }) === 'card-A', 'the bank\'s spelling does not matter, and account_masked serves when card_masked is absent');
    ok(target('THIRDBANK', { card_masked: '4444' }) === null, 'the right digits at another bank is not a match');
    ok(target('TESTBANK', { card_masked: '9999' }) === null, 'a card the person has not set up -> no account (the notice is simply retired)');
    ok(target('TESTBANK', {}) === null, 'no digits -> no account: the bank\'s only card is still a guess');
    ok(target('TESTBANK', { card_masked: '8888' }) === null, 'a deposit account is never the target of a card notice');

    const facts = (x) => { ctx.__x = x; return vm.runInContext('fhNoticeFacts(__x)', ctx); };
    const f = facts({ notice: { statement_date: '2026-09-05', due_date: '2026-09-25', min_payment: 1200000, closing_debt: 8400000 } });
    ok(f && f.dueDay === 25 && f.statementDay === 5 && f.minK === 1200 && f.debtK === 8400 && f.due === '2026-09-25', 'days of the month, and amounts in the ledger\'s units', f);
    ok(facts({ notice: null }) === null && facts({}) === null, 'a notice that states nothing is nothing');
    ok(facts({ notice: { due_date: 'soon', min_payment: 'abc' } }) === null, 'and neither is one that states it unreadably');
  }

  console.log('\nthe quiet pass');
  {
    const accounts = [{ id: 'card-A', kind: 'credit_card', tail: '4444', provider: 'testbank', dueDay: null, statementDay: 12 }];
    const state = { hasColumn: true, queries: [], rows: [
      txn('t1'),
      notice('n-old', 'TESTBANK', { card_masked: '4444', notice: { due_date: '2026-08-25', min_payment: 900000 } }, { occurred_at: '2026-08-10T03:00:00Z' }),
      notice('n-new', 'TESTBANK', { card_masked: '4444', notice: { statement_date: '2026-09-05', due_date: '2026-09-25', min_payment: 1200000, closing_debt: 8400000 } }),
      notice('n-none', 'TESTBANK', { card_masked: '9999', notice: { due_date: '2026-09-20' } }),
      notice('n-locked', 'TESTBANK', { card_masked: '4444', notice: { due_date: '2026-09-30' } }, { __locked: true }),
    ] };
    state.rows.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const ctx = device(state, accounts);
    const n = await vm.runInContext('fhNoticesApply()', ctx);
    ok(n === 3, 'three notices handled; the one that would not open is left staged', n);
    ok(JSON.stringify(ctx.resolved) === JSON.stringify([['resolve_email_transactions', ['n-old', 'n-new', 'n-none']]]),
      'retired through the same RPC, in one call: applied or not, but never the unreadable one and never a transaction', ctx.resolved);
    ok(ctx.updates.length === 1 && ctx.updates[0][0] === 'card-A' && ctx.updates[0][1].dueDay === 25 && !('statementDay' in ctx.updates[0][1]),
      'due_day filled because it was empty; the statement day the person had set is NOT overwritten', ctx.updates);
    const kept = ctx.fhAcctNoticeFacts['card-A'];
    ok(kept && kept.due === '2026-09-25' && kept.minK === 1200 && kept.debtK === 8400, 'the newest notice has the last word', kept);
    ok(Object.keys(ctx.fhAcctNoticeFacts).length === 1, 'nothing is kept for an account that does not exist', Object.keys(ctx.fhAcctNoticeFacts));
    const saved = ctx.__store['fh-acct-notice:user-1'];
    ok(saved && saved.indexOf('enc:') === 0 && saved.indexOf('8400') < 0, 'what stays on the device is encrypted under the personal key, never plain figures', saved && saved.slice(0, 12));
    ok(ctx.toasts === 0, 'never a toast', ctx.toasts);
    ok(!('anchorK' in (ctx.updates[0][1])) && !/fhPersonalExtBalanceSet|anchorK/.test(grab(SRC72, 'window.fhNoticesApply = async function ()')),
      'and the closing debt is never written as a balance: cards do not receive a captured balance');
    ok((await vm.runInContext('fhNoticesApply()', ctx)) === 0, 'a second call right away does nothing (it throttles itself)');
  }

  console.log('\na locked personal ledger cannot match anything');
  {
    const state = { hasColumn: true, queries: [], rows: [notice('n1', 'TESTBANK', { card_masked: '4444', notice: { due_date: '2026-09-25' } })] };
    const ctx = device(state, []);
    ctx.fhPersonalData = () => ({ state: 'locked', key: null, accounts: [] });
    ok((await vm.runInContext('fhNoticesApply()', ctx)) === 0 && ctx.resolved.length === 0 && state.queries.length === 0, 'so the notices wait, staged, and nothing is retired unread');
  }

  console.log('\nthe one quiet line on the account tile');
  {
    const ctx = { window: null, fhAcctNoticeFacts: {}, fmt: (n) => (Number(n) * 1000).toLocaleString('vi-VN') + 'đ', LANG: 'vi' };
    ctx.window = ctx; ctx.L = (vi, en) => (ctx.LANG === 'vi' ? vi : en);
    vm.createContext(ctx);
    vm.runInContext("const _dmy = (iso) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';\n" + grab(SRC23, 'function _noticeLine(') + '\nthis._noticeLine = _noticeLine;', ctx);
    const far = (new Date().getFullYear() + 1) + '-09-25';
    ctx.fhAcctNoticeFacts = { a: { due: far, minK: 1200 }, b: { due: far, minK: null }, c: { due: '2020-01-25', minK: 500 } };
    ok(ctx._noticeLine('a') === 'Đến hạn 25/09 · tối thiểu 1.200.000đ', 'Vietnamese, as the spec words it', ctx._noticeLine('a'));
    ctx.LANG = 'en';
    ok(ctx._noticeLine('a') === 'Due 25/09 · minimum 1.200.000đ', 'and English', ctx._noticeLine('a'));
    ok(ctx._noticeLine('b') === 'Due 25/09', 'no minimum printed -> the date alone', ctx._noticeLine('b'));
    ok(ctx._noticeLine('c') === '' && ctx._noticeLine('zzz') === '', 'a due date already behind us, or no notice at all -> no line');
    ok(/const nline = _noticeLine\(c\.acct\.id\);[\s\S]{0,120}else if \(due\)/.test(SRC23), 'it takes the place of the due-day chip it would otherwise repeat');
  }

  console.log(failed ? '\n' + failed + ' failed' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
