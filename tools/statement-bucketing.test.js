#!/usr/bin/env node
/* Statement rows through the REAL review bucketing.
 * `node tools/statement-bucketing.test.js`
 *
 * The client design claims a statement row needs no second review path because it
 * is shaped like an opened email row. This drives the actual bucketCsvCandidates
 * (57) and dedup engine (58) in staged mode, with window._fhStagedRows holding real
 * fhStmtAsStaged output, and checks the three places that claim could break:
 *   1. day-only rows: two honest same-amount purchases of one day must BOTH survive
 *   2. a statement row and a still-pending EMAIL for the same second must collapse
 *      to one card (the richest copy), not import twice
 *   3. a statement row already in the ledger lands in "Đã có trong sổ", not ready
 * (docs/specs/statement-capture-spec.md sections 3.4 and 11)
 */
// NOT 'use strict': eval'd declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '57-csv-import-review.js'), 'utf8');
function normDescForDedup(x){ return String(x||'').trim().toLowerCase().replace(/\s+/g,' '); }
function deburr(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
eval(fs.readFileSync(path.join(__dirname, '..', 'src', 'js-ui', '58-dedup-engine.js'), 'utf8'));
var window = { txns: [], DB: { ownerMemberId: 'me' }, csvStagedMode: true };
var curMult = function(){ return 1000; };
var csvStagedMode = true;
const fx = (name) => { const j = src.indexOf('function ' + name); if (j < 0) { console.error(name + ' not found'); process.exit(1); } return src.slice(j, src.indexOf('\n}', j) + 2); };
eval(fx('csvInfoScore'));
const bi = src.indexOf('function bucketCsvCandidates');
eval(src.slice(bi, src.indexOf('\n}', src.indexOf('return { ready: ready', bi)) + 2));

// 77, for the real row shape
const CSV_MCC_CONCEPT = {};
new Function('window', 'CSV_MCC_CONCEPT', 'L', '_esc', '_escAttr', '_rpc', 'localStorage', 'sessionStorage', 'document', 'crypto',
  fs.readFileSync(path.join(__dirname, '..', 'src', 'js-data', '77-statement-capture.js'), 'utf8'))(
  window, CSV_MCC_CONCEPT, (vi) => vi, (s) => s, (s) => s, async () => null, { getItem() { return null; }, setItem() {}, removeItem() {} }, { setItem() {} }, {}, require('crypto').webcrypto);

// the accessors 72 provides, reduced to what bucketing reads
window.fhStagedRawX = (i) => (window._fhStagedRows[i] || {}).raw_extracted || null;
window.fhStagedMeta = (i) => { const r = window._fhStagedRows[i]; return r ? { provider: r.source_provider, kind: 'other', dupOfId: '', currency: 'VND', occurredAt: r.occurred_at, pipelineDup: false } : null; };
window.fhStagedKindById = () => '';
function csvRowTime(c){ const r = window._fhStagedRows[c.rowIndex]; const d = new Date(r.occurred_at); if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return ''; return String((d.getUTCHours() + 7) % 24).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); ok ? pass++ : fail++; };

const stmtRow = (o) => window.fhStmtAsStaged(o.id, { sid: 'S1', date: o.date, time: o.time || '', sec: o.sec || '00', amt: -o.amount, bal: null, ref: o.ref || '',
  memo: o.memo, counterparty: o.cp || '', person: false, flow: '', xfer: false, attn: false, provider: o.provider || 'VIB', accountKind: o.kind || 'deposit', tail: '3444' });
const emailRow = (o) => ({ id: o.id, member_id: 'm1', source_provider: o.provider, occurred_at: o.at, amount: o.amount, currency: 'VND', direction: 'debit', counterparty: o.cp || '',
  duplicate_of_id: null, resolved_before: false, raw_extracted: { memo: o.memo, memo_display: o.memo, transaction_type: 'ecommerce_receipt', flow: 'expense', account_kind: 'ewallet', _transport: 'oauth_direct', category_hint: 'Dining', reference_number: o.ref || '' } });
const candsFor = (rows) => rows.map((r, i) => ({ rowIndex: i, description: r.raw_extracted.memo || '', _hasDesc: !!r.raw_extracted.memo, counterparty: r.counterparty || '',
  amount: r.amount, date: new Date(r.occurred_at), dateDisplay: r.occurred_at.slice(0, 10), categoryName: 'Khác', flags: [], isIncome: false, isTransfer: false }));
const bucket = (rows, ledger) => { window._fhStagedRows = rows; window.txns = []; window._fhPersonalMatchSlice = ledger || []; return bucketCsvCandidates(candsFor(rows), false); };

console.log('\n-- 1. day-only: two honest same-amount purchases on one day --');
var r = bucket([stmtRow({ id: 'a', date: '2026-08-07', amount: 45000, memo: 'Phi duy tri tai khoan' }), stmtRow({ id: 'b', date: '2026-08-07', amount: 45000, memo: 'FC12-0000012345' })]);
t('both survive: a day-only instant is never a merge key', r.ready.length === 2 && r.mergedCount === 0, { ready: r.ready.length, merged: r.mergedCount });

console.log('\n-- 2. a statement row and a pending EMAIL for the same second --');
var same = [emailRow({ id: 'e1', provider: 'MoMo', at: '2026-08-05T01:29:06+00:00', amount: 65000, memo: 'EVERY HALF COFFEE ROASTERS', cp: 'EVERY HALF COFFEE ROASTERS' }),
            stmtRow({ id: 's1', provider: 'MoMo', kind: 'ewallet', date: '2026-08-05', time: '08:29', sec: '06', amount: 65000, memo: 'Thanh toán EVERY HALF COFFEE ROASTERS', cp: 'EVERY HALF COFFEE ROASTERS', ref: '90000015838' })];
r = bucket(same);
t('they collapse to ONE card', r.ready.length === 1 && r.mergedCount === 1, { ready: r.ready.length, merged: r.mergedCount, dup: r.possibleDuplicate.length });
t('...and the spelling is what made it possible: both instants are the same string', same[0].occurred_at === same[1].occurred_at, [same[0].occurred_at, same[1].occurred_at]);
var near = [emailRow({ id: 'e2', provider: 'MoMo', at: '2026-08-05T01:29:40+00:00', amount: 65000, memo: 'EVERY HALF COFFEE ROASTERS', cp: 'EVERY HALF COFFEE ROASTERS' }), same[1]];
r = bucket(near);
t('seconds apart: not merged, but flagged rather than both imported', r.possibleDuplicate.length === 1 && r.possibleDuplicate[0]._dupWhy === 'statement_echo' && r.possibleDuplicate[0]._dupTier === 'likely', { ready: r.ready.length, dup: r.possibleDuplicate.map((c) => c._dupWhy) });
var hours = [emailRow({ id: 'e3', provider: 'MoMo', at: '2026-08-05T05:00:00+00:00', amount: 65000, memo: 'EVERY HALF COFFEE ROASTERS', cp: 'EVERY HALF COFFEE ROASTERS' }), same[1]];
r = bucket(hours);
t('hours apart on the same day: two coffees, both ready', r.ready.length === 2 && r.possibleDuplicate.length === 0, { ready: r.ready.length, dup: r.possibleDuplicate.length });
var twoStmt = [stmtRow({ id: 's2', provider: 'MoMo', kind: 'ewallet', date: '2026-08-05', time: '08:29', sec: '06', amount: 65000, memo: 'GRAB', cp: 'GRAB', ref: '1' }), stmtRow({ id: 's3', provider: 'MoMo', kind: 'ewallet', date: '2026-08-05', time: '08:31', sec: '00', amount: 65000, memo: 'GRAB', cp: 'GRAB', ref: '2' })];
r = bucket(twoStmt);
t('two STATEMENT rows alike are two rides, never an echo', r.possibleDuplicate.every((c) => c._dupWhy !== 'statement_echo'), r.possibleDuplicate.map((c) => c._dupWhy));
var dayOnly = [emailRow({ id: 'e4', provider: 'VIB', at: '2026-08-07T03:10:00+00:00', amount: 45000, memo: 'FC12-0000012345' }), stmtRow({ id: 's4', provider: 'VIB', date: '2026-08-07', amount: 45000, memo: 'FC12-0000012345' })];
r = bucket(dayOnly);
t('a day-only statement row echoes a same-day email from that bank', r.possibleDuplicate.length === 1, { ready: r.ready.length, dup: r.possibleDuplicate.map((c) => c._dupWhy) });

console.log('\n-- 3. a statement row the ledger already has --');
var booked = [{ id: 'p1', date: '2026-08-20', kind: 'expense', amt: 412.3, note: 'WINMART Q1', link: null, src: 'direct-email', time: '', cat: 'Đi chợ' }];
r = bucket([stmtRow({ id: 'c', date: '2026-08-20', amount: 412300, memo: 'Mua Hàng / WINMART Q1', kind: 'credit_card' })], booked);
var hit = r.possibleDuplicate[0];
t('lands in "Đã có trong sổ" with the booked row as evidence', r.ready.length === 0 && hit && hit._dupTier === 'sure' && hit._dupTwin && hit._dupTwin.book === 'personal', hit && { tier: hit._dupTier, why: hit._dupWhy });
r = bucket([stmtRow({ id: 'd', date: '2026-08-20', amount: 412300, memo: 'Mua Hàng / WINMART Q1', kind: 'credit_card' })], []);
t('with an empty ledger the same row is simply ready: a statement-only source imports everything', r.ready.length === 1 && r.possibleDuplicate.length === 0);

console.log('\n' + (fail ? fail + ' FAILED, ' : 'ALL ') + pass + ' PASSED');
process.exit(fail ? 1 : 0);
