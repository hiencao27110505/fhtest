#!/usr/bin/env node
/* A shape has no opinion about whether one transaction succeeded.
 * `node pipeline/status-not-static.test.js`
 *
 * `deriveExtractionTemplate` used to freeze `status` — the value the ONE mail it
 * learned from happened to report — into the template for the whole shape. Every
 * later mail of that shape then carried that mail's outcome, and it failed in
 * both directions:
 *
 *   • a live Vietcombank card template was derived off a DECLINED attempt and
 *     staticised "Không thành công", so a real purchase off the same shape would
 *     have staged as failed;
 *   • the mirror case is worse — derive off a success and a declined attempt
 *     stages as real spending, which is money the ledger loses twice.
 *
 * Neither self-corrects. statusReadsFailed() reads the mail's OWN status row, so
 * a success body never contradicts a template that claims failure.
 *
 * Pinned here, one per way this could come back:
 *   • no derived template carries a status static, whatever the mail said
 *   • dropping it did not break derivation (the verification list had to lose
 *     `status` in the same change, or every status-bearing mail fails to derive)
 *   • the .gs and the .mjs made the change identically — they share one cache,
 *     so a divergence returns a different reading rather than throwing
 *   • an OLD template that still carries the static is still applied, because
 *     0104 is what removes those and the code must not depend on it having run
 */
const fs = await import('node:fs');
const url = await import('node:url');

const HERE = url.fileURLToPath(new URL('.', import.meta.url));
const src = fs.readFileSync(HERE + 'bank-email-pipeline.gs', 'utf8');
globalThis.Logger = { log: () => {} };
/* Same re-slice-at-test-time trick as direct-templates.test.js: compare the two
   implementations' BEHAVIOUR, so editing one side fails and editing both the
   same way passes.
   INDIRECT eval — `(0, eval)` — because this file is an ES module and modules
   are always strict, where a direct eval scopes its own `var`/`function`
   declarations to the eval and they never reach us. Indirect eval runs in the
   global sloppy scope, so the .gs slice lands on globalThis the way the .gs
   itself expects. */
(0, eval)(src.slice(src.indexOf('var EXTRACTION_LOGIC_VERSION'), src.indexOf('function upsertFingerprint')));
const gsDerive = globalThis.deriveExtractionTemplate;

const M = await import('../supabase/functions/_shared/mailbox/templates.mjs');

let pass = 0, fail = 0;
const t = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (!ok && d ? '  -> ' + d : '')); ok ? pass++ : fail++; };

/* A VCB card receipt, in the line form the direct reader produces. The same
   shape arrives both ways; only the outcome row differs between the two mails. */
const bodyFor = (status) => [
  'Số tiền', 'Transaction Amount', '', '337,900 VND', '',
  'Ngày, giờ giao dịch', 'Trans. Date, Time', '', '26-08-2026 20:04:26', '',
  'Sử dụng tại', 'At', '', 'AEON MALL NGUYEN VAN LINH', '',
  'Trạng thái', 'Status', '', status,
].join('\n');

const readingFor = (status) => ({
  is_transaction: true, transaction_type: 'ecommerce_receipt', source_provider: 'Vietcombank',
  occurred_at: '2026-08-26T20:04:26+07:00', amount: 337900, currency: 'VND', direction: 'debit',
  counterparty: 'AEON MALL NGUYEN VAN LINH', reference_number: null, status,
  account_masked: null, memo: null,
});

const OK = 'Thành công', NO = 'Không thành công';

console.log('\n-- a status-bearing mail still derives a template --');
for (const [label, status] of [['success', OK], ['declined', NO]]) {
  const mjs = M.deriveExtractionTemplate(bodyFor(status), readingFor(status));
  const gs = gsDerive(bodyFor(status), readingFor(status));
  t(`derives off a ${label} mail (dropping status must not break the proof)`, !!mjs, String(mjs));
  t(`  ...and the .gs agrees exactly`, mjs === gs, 'mjs=' + mjs + '\ngs =' + gs);
  t(`  ...carrying NO status static`,
    !!mjs && !('status' in JSON.parse(mjs).static), mjs && JSON.stringify(JSON.parse(mjs).static));
}

console.log('\n-- the shape learned from a decline says nothing about a success --');
const fromDeclined = M.deriveExtractionTemplate(bodyFor(NO), readingFor(NO));
const onSuccess = M.applyExtractionTemplate(fromDeclined, bodyFor(OK));
t('applies to the success mail', !!onSuccess, String(onSuccess));
t('reads the real merchant', onSuccess && onSuccess.counterparty === 'AEON MALL NGUYEN VAN LINH');
t('and does NOT claim the transaction failed  <-- the bug',
  !!onSuccess && onSuccess.status === undefined, JSON.stringify(onSuccess && onSuccess.status));

console.log('\n-- and the mirror: a decline is not staged as spending --');
const fromSuccess = M.deriveExtractionTemplate(bodyFor(OK), readingFor(OK));
const onDeclined = M.applyExtractionTemplate(fromSuccess, bodyFor(NO));
t('applies to the declined mail', !!onDeclined);
t('claims no status of its own', !!onDeclined && onDeclined.status === undefined);

console.log('\n-- an OLD template that still carries the static keeps working --');
/* 0104 strips these, but the reader must not depend on the migration having run:
   a template written before this change is still v4 and still valid. */
const legacy = JSON.parse(fromSuccess);
legacy.static.status = NO;
const onLegacy = M.applyExtractionTemplate(JSON.stringify(legacy), bodyFor(OK));
t('still applies', !!onLegacy);
t('still carries its (wrong) frozen status — which is why 0104 exists',
  !!onLegacy && onLegacy.status === NO);

console.log('\n' + pass + ' pass, ' + fail + ' fail\n');
if (fail) process.exit(1);
