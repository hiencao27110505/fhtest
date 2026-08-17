#!/usr/bin/env node
/* Cross-source dedup must not collapse two transactions from the SAME bank.
 * `node pipeline/dedup-provider.test.js`
 *
 * The regression this exists for, observed in production on 2026-08-16: three MB
 * transactions staged the same morning, and the middle one silently disappeared.
 * `source_provider` is free text from the extractor and MB's own emails identify
 * the bank three different ways depending on the template -- 'MB', 'MBBank',
 * 'MB eBanking'. findDuplicate's cross-source rule compared those raw strings, so
 * one bank looked like three sources and two genuine transactions looked like one
 * event reported twice.
 *
 * It failed silently in both directions at once: a row with duplicate_of_id set
 * is filtered out of the review queue (`.is('duplicate_of_id', null)`) AND skipped
 * by queueReviewNotice. No row, no notification, no error.
 *
 * The provider strings below are verbatim from the live rows.
 */
// NOT 'use strict': eval'd .gs declarations must land in this scope.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'bank-email-pipeline.gs'), 'utf8');

var DEDUPE_WINDOW_DAYS = 3;
var _stubRows = [];
function supabaseGet() { return _stubRows; }
// Post-merge with sealed staging: findDuplicate branches on the sealing gate
// (defined outside this slice). Off = the amount-query era this test targets.
function sealedStagingEnabled() { return false; }

eval(src.slice(src.indexOf('function findDuplicate'), src.indexOf('// ---------- memo tidying')));

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

console.log('\n-- one bank, however it spells itself --');
const MB = ['MB', 'MBBank', 'MB eBanking', 'MB Bank', 'mb ebanking', 'MB  E-Banking'];
const mbCanon = MB.map(canonicalProvider);
t('every MB spelling reduces to one identity', new Set(mbCanon).size === 1, JSON.stringify(mbCanon));
t('and that identity is "mb"', mbCanon[0] === 'mb', mbCanon[0]);

console.log('\n-- but different banks stay different --');
// MSB is the one that must not be over-stripped into MB: it carries no channel
// word, so nothing is removed and it cannot collide.
t('MSB is not MB', canonicalProvider('MSB') !== canonicalProvider('MB'),
  canonicalProvider('MSB') + ' vs ' + canonicalProvider('MB'));
t('Vietcombank is not Vietinbank',
  canonicalProvider('Vietcombank') !== canonicalProvider('Vietinbank'));
t('Techcombank is not TPBank',
  canonicalProvider('Techcombank') !== canonicalProvider('TPBank'));
t('Vietcombank is not MB', canonicalProvider('Vietcombank') !== canonicalProvider('MB'));
t('a bank keeps its distinguishing stem', canonicalProvider('Vietcombank') === 'vietcom',
  canonicalProvider('Vietcombank'));

console.log('\n-- Vietnamese spelling --');
t('accents do not create a second bank',
  canonicalProvider('Kỹ Thương') === canonicalProvider('Ky Thuong'));

console.log('\n-- missing provider is never a match --');
t('null canonicalises to empty', canonicalProvider(null) === '');
t('undefined canonicalises to empty', canonicalProvider(undefined) === '');
t('empty string canonicalises to empty', canonicalProvider('') === '');

console.log('\n-- the live regression: two MB rows, same amount, same day --');
const day = '2026-08-16T08:05:30+00:00';
_stubRows = [{
  id: 'b68a01ad', source_provider: 'MBBank', amount: 2000,
  occurred_at: '2026-08-16T08:05:30+00:00', created_at: '2026-08-16T08:05:31+00:00',
}];
t('an MB eBanking row is NOT a duplicate of an MBBank row',
  findDuplicate(2000, 'debit', '2026-08-16T08:07:18+00:00', 'MB eBanking') === null);
t('nor is a bare "MB" row',
  findDuplicate(2000, 'debit', '2026-08-16T08:12:50+00:00', 'MB') === null);

console.log('\n-- while genuine cross-source dedup still works --');
t('a merchant receipt DOES match the bank email for the same purchase',
  findDuplicate(2000, 'debit', day, 'Shopee') !== null);

console.log('\n-- and an unknown provider is never guessed at --');
_stubRows = [{
  id: 'x', source_provider: null, amount: 2000,
  occurred_at: day, created_at: '2026-08-16T08:05:31+00:00',
}];
t('a stored row with no provider is not a duplicate of anything',
  findDuplicate(2000, 'debit', day, 'MB') === null);
_stubRows = [{
  id: 'y', source_provider: 'MBBank', amount: 2000,
  occurred_at: day, created_at: '2026-08-16T08:05:31+00:00',
}];
t('an incoming row with no provider matches nothing either',
  findDuplicate(2000, 'debit', day, null) === null);

console.log('\n-- the window still bounds it --');
_stubRows = [{
  id: 'z', source_provider: 'Shopee', amount: 2000,
  occurred_at: '2026-08-30T00:00:00+00:00', created_at: '2026-08-30T00:00:01+00:00',
}];
t('a cross-source row outside the window is not a duplicate',
  findDuplicate(2000, 'debit', day, 'MB') === null);

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' PASSED' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail ? 1 : 0);
