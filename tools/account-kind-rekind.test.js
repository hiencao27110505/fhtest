#!/usr/bin/env node
/* Kind is metadata, identity is the number: what the census may re-kind.
 * `node tools/account-kind-rekind.test.js`
 *
 * full-ledger T12: an instrument's identity is (provider, tail); kind is
 * editable metadata and never part of the ensure() match. The census at review
 * open (72-txn-review.js fhQueueAccountCensus) runs ensure() over every row's
 * own instrument, and this pins what it does with a KIND that disagrees with
 * the account the app already holds:
 *
 *   - a row sealed `credit_card` over a tail the app holds as a deposit (or a
 *     wallet): nothing changes. The classifier's card guess is how the ••5140
 *     ghost was minted; it must never re-kind a real account.
 *   - an account held as `credit_card` that a v2 row says is a deposit on a
 *     PRINTED fact (or a verified format's fact): re-kinded to deposit. A
 *     printed fact beats an earlier guess.
 *   - the same row on a heuristic or model verdict: nothing changes. A guess
 *     never overwrites anything.
 *   - an account the person set the kind of themselves (human_verified):
 *     never touched, whatever the row says.
 *   - never the other way: nothing is ever re-kinded TO credit_card (a
 *     wrongly claimed card invents a debt).
 *
 * Synthetic names and numbers only.
 */
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failed = 0;
function ok(cond, what, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + what + (!cond && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}

const SRC72 = read('src/js-data/72-txn-review.js');
const SRC57 = read('src/js-ui/57-csv-import-review.js');

/* Only what the census needs: the personal ledger's ensure()/update() with
   19-personal.js semantics (identity (provider, tail); a hit is returned
   untouched), fhProviderName, and the staged-row accessors. */
function device(accounts) {
  const state = { accounts: (accounts || []).map((a) => Object.assign({}, a)), updated: [], seq: 0 };
  const ctx = { console };
  ctx.window = ctx;
  ctx.__state = state;
  ctx.fhPersonalData = () => ({ state: 'ready', key: 'k', accounts: state.accounts, txns: [], debts: [] });
  ctx.fhPersonalAccountEnsure = async (info) => {
    if (!info || !info.kind) return null;
    const prov = (info.provider || '').toLowerCase() || null;
    const tail = (info.tail || '').replace(/\D/g, '').slice(-4) || null;
    const hit = state.accounts.find((a) => (a.provider || '') === (prov || '') && (a.tail || '') === (tail || ''));
    if (hit) return hit.id;
    const id = 'new-' + (++state.seq);
    state.accounts.push({ id, kind: info.kind, provider: prov, tail, name: info.name, humanVerified: false });
    return id;
  };
  ctx.fhPersonalAccountUpdate = async (id, fields) => {
    state.updated.push([id, Object.assign({}, fields)]);
    const a = state.accounts.find((x) => x.id === id);
    if (a && fields.kind) a.kind = fields.kind;
    return !!a;
  };
  vm.createContext(ctx);
  // deburr + csvCanonicalProvider + the provider canon, for fhProviderName.
  vm.runInContext('function deburr(s){return String(s).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D");}', ctx);
  // the provider registry (generated) — fhAcctProviderKey resolves through it
  vm.runInContext(read('src/js-ui/09-providers.js'), ctx);
  vm.runInContext(SRC57.slice(SRC57.indexOf('var CSV_PROVIDER_NOISE'), SRC57.indexOf('window.fhProviderName = fhProviderName;')) + 'window.fhProviderName = fhProviderName;\n'
    + SRC57.slice(SRC57.indexOf('function csvCanonicalProvider(name)'), SRC57.indexOf('/* Ledger, near-miss, pipeline and cross-source matching')), ctx);
  vm.runInContext(SRC72.slice(SRC72.indexOf('window.fhStagedRawX = function'), SRC72.indexOf('/* Card-payment candidates still waiting in the inbox')), ctx);
  return ctx;
}
/* An OPENED staged row whose own instrument is VIB ••5140. */
function row(kind, src, extra) {
  return { id: 'r-' + kind + '-' + src, source_provider: 'VIB', amount: 2150000, currency: 'VND', direction: 'debit',
    raw_extracted: Object.assign({ v: 2, amount: 2150000, currency: 'VND', direction: 'debit',
      account_kind: kind, account_masked: '…5140', src: src ? { account_kind: src, amount: 'printed' } : {} }, extra || {}) };
}
async function census(ctx, rows) {
  ctx._fhStagedRows = rows;
  ctx._fhQueueNewAccts = [];
  await vm.runInContext('fhQueueAccountCensus(_fhStagedRows)', ctx);
}
const acct = (ctx) => ctx.__state.accounts.find((a) => a.provider === 'vib' && a.tail === '5140');

(async () => {
  console.log('a card guess never re-kinds a real account');
  for (const held of ['deposit', 'ewallet']) {
    for (const src of ['heuristic', 'template', 'printed', 'model']) {
      const ctx = device([{ id: 'vib-5140', kind: held, provider: 'vib', tail: '5140', name: 'VIB ••5140' }]);
      await census(ctx, [row('credit_card', src)]);
      ok(acct(ctx).kind === held && ctx.__state.accounts.length === 1 && ctx.__state.updated.length === 0,
        'held as ' + held + ', row says credit_card (' + src + '): untouched, no twin', [ctx.__state.accounts, ctx.__state.updated]);
    }
  }

  console.log('a printed deposit fact re-kinds a card the classifier minted');
  for (const src of ['printed', 'template']) {
    const ctx = device([{ id: 'vib-5140', kind: 'credit_card', provider: 'vib', tail: '5140', name: 'VIB ••5140' }]);
    await census(ctx, [row('deposit', src)]);
    ok(acct(ctx).kind === 'deposit' && ctx.__state.updated.length === 1 && ctx.__state.updated[0][0] === 'vib-5140' && ctx.__state.updated[0][1].kind === 'deposit',
      'held as credit_card, row says deposit (' + src + '): re-kinded through fhPersonalAccountUpdate', [acct(ctx), ctx.__state.updated]);
    ok(ctx.__state.accounts.length === 1 && ctx._fhQueueNewAccts.length === 0, '...the same account, not a new one', ctx.__state.accounts);
  }
  {
    const ctx = device([{ id: 'vib-5140', kind: 'credit_card', provider: 'vib', tail: '5140', name: 'VIB ••5140' }]);
    await census(ctx, [row('deposit', 'printed'), row('deposit', 'printed')]);
    ok(ctx.__state.updated.length === 1, 'two such rows: one update', ctx.__state.updated);
  }

  console.log('a guess never overwrites');
  for (const src of ['heuristic', 'model', null]) {
    const ctx = device([{ id: 'vib-5140', kind: 'credit_card', provider: 'vib', tail: '5140', name: 'VIB ••5140' }]);
    await census(ctx, [row('deposit', src)]);
    ok(acct(ctx).kind === 'credit_card' && ctx.__state.updated.length === 0,
      'held as credit_card, row says deposit (' + (src || 'no src') + '): untouched', [acct(ctx), ctx.__state.updated]);
  }
  {
    const ctx = device([{ id: 'vib-5140', kind: 'credit_card', provider: 'vib', tail: '5140', name: 'VIB ••5140' }]);
    await census(ctx, [Object.assign(row('deposit', 'printed'), { raw_extracted: Object.assign(row('deposit', 'printed').raw_extracted, { v: 1 }) })]);
    ok(acct(ctx).kind === 'credit_card' && ctx.__state.updated.length === 0, 'a v1 row (no provenance to speak of): untouched', ctx.__state.updated);
  }

  console.log('a person\'s own verdict is never touched');
  {
    const ctx = device([{ id: 'vib-5140', kind: 'credit_card', provider: 'vib', tail: '5140', name: 'Thẻ VIB', humanVerified: true }]);
    await census(ctx, [row('deposit', 'printed')]);
    ok(acct(ctx).kind === 'credit_card' && ctx.__state.updated.length === 0, 'human_verified credit_card, printed deposit row: untouched', ctx.__state.updated);
  }

  console.log('nothing is ever re-kinded TO credit_card');
  {
    const ctx = device([{ id: 'vib-5140', kind: 'deposit', provider: 'vib', tail: '5140', name: 'VIB ••5140' }]);
    await census(ctx, [row('credit_card', 'printed'), row('credit_card', 'template')]);
    ok(acct(ctx).kind === 'deposit' && ctx.__state.updated.length === 0, 'even a printed card verdict re-kinds nothing', ctx.__state.updated);
  }
  {
    // A wallet the wallet-provider rule kinded, and a sealed deposit for it: the
    // re-kind only ever runs card -> deposit.
    const ctx = device([{ id: 'momo-x', kind: 'ewallet', provider: 'momo', tail: '0099', name: 'MoMo ••0099' }]);
    await census(ctx, [Object.assign(row('deposit', 'printed'), { source_provider: 'MoMo', raw_extracted: Object.assign(row('deposit', 'printed').raw_extracted, { account_masked: '…0099' }) })]);
    ok(ctx.__state.accounts[0].kind === 'ewallet' && ctx.__state.updated.length === 0, 'a wallet is not re-kinded by a deposit fact (only a card is)', ctx.__state.updated);
  }

  console.log('the source reads the way the rule is stated');
  const census_src = SRC72.slice(SRC72.indexOf('window.fhQueueAccountCensus = async function'), SRC72.indexOf('/* Card-payment candidates still waiting in the inbox'));
  ok(/cur\.kind === 'credit_card' && !cur\.humanVerified/.test(census_src), 'the re-kind is gated on credit_card and not human_verified');
  ok(/x\.src\.account_kind === 'printed' \|\| x\.src\.account_kind === 'template'/.test(census_src), '...and on a printed or template-grade account_kind');
  ok(!/kind: 'credit_card'/.test(census_src), '...and never writes credit_card');
  ok(/window\.fhQueueAccountCensus\(readable\)\.catch/.test(SRC72), 'the open path calls the census fire-and-forget');

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
