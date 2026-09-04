#!/usr/bin/env node
/* The vocabulary learns from the model — conservatively, reversibly, provably.
 * `node pipeline/learned-labels.test.js`
 *
 * THE ASYMMETRY THIS CLOSES. Templates have learned since August; the label
 * vocabulary never has. VIB pays a model call per SHAPE because five words are
 * missing from a hand-authored dictionary, and extract_miss_labels collects
 * the evidence that nothing consumes.
 *
 * THE CONTRACTS, each with its own assertion, strictest first:
 *   • KILL SWITCH: with no learned rows, behaviour is byte-for-byte the
 *     hand-authored reader. `delete from learned_labels` IS the rollback.
 *   • hardcoded LABELS beats a learned mapping, always
 *   • banned fields are never learned: amount, occurred_at, account, status —
 *     a heuristic must not be able to steer a number in a ledger
 *   • an ambiguous label (two fields claim it) is dropped, not coin-flipped
 *   • merchant/beneficiary learn only under the type that disambiguates them
 *   • labels only — never a value — leave the learner
 */
const url = await import('node:url');
const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const ROOT = HERE + '../supabase/functions/_shared/mailbox/';
const LT = await import(ROOT + 'labeltable.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* The REAL second VIB mail (info@myvib.vib.com.vn, 02-09-2026) — the shape the
   hand-authored vocabulary reads 3 of 9 labels of. */
const VIB = [
  'Thanh toán thẻ tín dụng VIB thành công', '',
  'Số giao dịch\t2609024028332978',
  'Trạng thái giao dịch\tThành công',
  'Ngày giao dịch\t11:57 02/09/2026',
  'Từ tài khoản\t609704060065140',
  'Số thẻ\tCAO THAI DUY HIEN - ●●●● 4751',
  'Ngân hàng hưởng\tNgân hàng TMCP Quốc tế Việt Nam',
  'Số tiền\t136,670 ₫',
  'Diễn giải\tThanh toan sao ke the Master Card 08/2026',
].join('\n').replace(/\t/g, ' | ');   // pipe form, as the row-walker reads tables

const READING = {
  is_transaction: true, transaction_type: 'bank_txn', source_provider: 'VIB',
  occurred_at: '2026-09-02T11:57:00+07:00', amount: 136670, currency: 'VND',
  direction: 'debit', counterparty: 'Ngân hàng TMCP Quốc tế Việt Nam',
  reference_number: '2609024028332978', status: 'Thành công',
  account_masked: '609704060065140', memo: 'Thanh toan sao ke the Master Card 08/2026',
};

console.log('\n-- what one model answer teaches --');
const votes = LT.deriveLabelMappings(VIB, READING);
const byLabel = Object.fromEntries(votes.map(v => [v.label, v.field]));
console.log('   votes:', JSON.stringify(votes));
t('"dien giai" -> memo', byLabel['dien giai'] === 'memo', JSON.stringify(byLabel));
t('banned: the date label is NOT learned, though its value was right there',
  !('ngay giao dich' in byLabel));
t('banned: the account label is NOT learned', !('tu tai khoan' in byLabel));
t('banned: the amount label is NOT learned', !('so tien' in byLabel));
t('bank_txn does not disambiguate who the counterparty is -> no vote',
  !('ngan hang huong' in byLabel));
t('reference IS learned — "so giao dich" was never in the vocabulary',
  byLabel['so giao dich'] === 'reference');
t('no VALUE leaves the learner — labels only',
  !/136|2609|609704|Master Card|CAO THAI/.test(JSON.stringify(votes)), JSON.stringify(votes));

console.log('\n-- type-conditioned counterparty learning --');
const shop = LT.deriveLabelMappings('Cua hang | Foody\nX | y\nZ | w', {
  is_transaction: true, transaction_type: 'ecommerce_receipt', counterparty: 'Foody',
  memo: null, reference_number: null });
t('an ecommerce receipt teaches merchant',
  shop.some(v => v.label === 'cua hang' && v.field === 'merchant'), JSON.stringify(shop));
const p2p = LT.deriveLabelMappings('Nguoi nhan cuoi | AN NGUYEN\nX | y\nZ | w', {
  is_transaction: true, transaction_type: 'p2p_transfer', counterparty: 'AN NGUYEN',
  memo: null, reference_number: null });
t('a transfer teaches beneficiary',
  p2p.some(v => v.label === 'nguoi nhan cuoi' && v.field === 'beneficiary'), JSON.stringify(p2p));

console.log('\n-- ambiguity is dropped, never coin-flipped --');
const amb = LT.deriveLabelMappings('Chi tiet | same-thing\nKhac | same-thing', {
  is_transaction: true, transaction_type: 'p2p_transfer',
  memo: 'same-thing', reference_number: 'same-thing', counterparty: null });
t('a label whose value matches two fields votes for neither',
  amb.length === 0, JSON.stringify(amb));

console.log('\n-- the reader: learned mappings EXTEND, hardcoded wins, kill switch holds --');
const learned = new Map([['ngay giao dich', 'memo'],        // hostile: tries to shadow a date label
                         ['dien giai', 'memo'],
                         ['ngan hang huong', 'beneficiary'],
                         ['so tien', 'memo']]);             // hostile: tries to shadow the amount
/* A body the hand-authored reader cannot fully read (VIB) — with learned
   mappings for memo + beneficiary, `who` and the gate change. */
const before = LT.readLabelTable('x', VIB);
t('without learning, VIB still returns null (date label unknown)', before === null);
/* THE HAND-ADD LANDED (2026-09-03), so this now asserts the opposite of what it
   used to. Until today the gate had no timestamp: VIB's date label ("Ngày giao
   dịch") was absent from the vocabulary, and occurred_at is on the BANNED list
   because a heuristic must never decide what a date label is. That last word
   was always going to be a deliberate HAND-AUTHORED addition, and it now is
   ('ngay giao dich' → occurred_at), so vocabulary + learning together open this
   shape.

   WHAT IT READS, AND WHERE IT STILL DIVERGES. Amount, instant, counterparty and
   memo all come back equal to the model's own answer on this mail. The type
   does not: `isTransfer` is true whenever a beneficiary was found, so a credit
   card bill payment reads p2p_transfer where the model said bank_txn. That is
   wrong but VISIBLE — it reaches a human in review, and nothing downstream
   spends money on it. Pinned rather than fixed here because the fix belongs to
   the type heuristic, not to a vocabulary entry, and a silent divergence
   between the two tiers reading one mail is exactly what this file exists to
   catch. */
t('with the date hand-added, learned mappings DO open this shape',
  LT.readLabelTable('x', VIB, learned) !== null);
t('  counterparty matches the model exactly, not a degraded guess',
  LT.readLabelTable('x', VIB, learned).counterparty === READING.counterparty);
t('  KNOWN DIVERGENCE: a card bill reads p2p_transfer, model said bank_txn',
  LT.readLabelTable('x', VIB, learned).transaction_type === 'p2p_transfer' &&
  READING.transaction_type === 'bank_txn');

/* Swap in the known date label and the learned mappings carry the rest. */
const VIB_KNOWN_DATE = VIB.replace('Ngày giao dịch', 'Thời gian giao dịch');
const after = LT.readLabelTable('x', VIB_KNOWN_DATE, learned);
t('with a known date label, learned memo+beneficiary open the gate', !!after, JSON.stringify(after));
if (after) {
  t('  learned memo read', after.memo === 'Thanh toan sao ke the Master Card 08/2026', JSON.stringify(after.memo));
  t('  learned beneficiary feeds who', after.counterparty === 'Ngân hàng TMCP Quốc tế Việt Nam');
  t('  the hostile "so tien"->memo mapping did NOT shadow the amount — hardcoded wins',
    after.amount === 136670, JSON.stringify(after.amount));
}
t('KILL SWITCH: an empty map is byte-for-byte the hand-authored reader',
  JSON.stringify(LT.readLabelTable('x', VIB, new Map())) === JSON.stringify(before) &&
  JSON.stringify(LT.readLabelTable('x', VIB_KNOWN_DATE, new Map())) ===
  JSON.stringify(LT.readLabelTable('x', VIB_KNOWN_DATE)));

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
