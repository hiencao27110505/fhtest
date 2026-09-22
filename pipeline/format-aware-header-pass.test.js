#!/usr/bin/env node
/* The metadata-first pass knows about formats (email-reading-v2 §8.2).
 * `node pipeline/format-aware-header-pass.test.js`
 *
 * The header pass settles "known junk / model-bound / fetch" from the
 * fingerprint alone, and a fingerprint knows nothing about formats: their key
 * is a hash of the mail's LABELS, which needs the body. So a shape the
 * fingerprint calls model-bound may still be readable, for free, by a seed or
 * a learned format. Driven through the real runGrant with the model OFF
 * (budget 0) and a fingerprint that says "transaction source, no template":
 *   1. the sender's provider has a format: the body IS fetched, the format
 *      tier gets its look, the model is still never called
 *   2. the provider has none: parked without a fetch, as the pass always did
 *      (held, when the db has no parking lot)
 *   3. one providerHasAny read per provider per run
 */
import { W, makeCtx, memoryDb, mailFor, settled, reporter } from './v2-harness.mjs';
const { t, done } = reporter();
const X = await import(new URL('../supabase/functions/_shared/mailbox/extract.mjs', import.meta.url));

const mail = (id) => mailFor(id, 'model', 'mau A');
const SEP = String.fromCharCode(0);
/* The fingerprint the header pass will find: this VIB shape is a transaction
   source with no v4 template (the classic model-bound row). */
async function modelBound(db) {
  const tpl = await X.subjectCacheKey('Thong bao mau A');
  db.fingerprints.set('info@vib.com.vn' + SEP + tpl, { sender_address: 'info@vib.com.vn', subject_template: tpl,
    is_transaction_source: true, transaction_type: null, extraction_regex: null });
}

console.log('\n-- 1. the provider has a format: fetched, format tier tried, no model call --');
{
  const db = memoryDb({ providerFormats: ['VIB'] });
  let asked = 0;
  const inner = db.formats.providerHasAny;
  db.formats.providerHasAny = async (p) => { asked++; return inner(p); };
  await modelBound(db);
  const ctx = makeCtx({ db, queue: ['a', 'b'], mail, maxModelCalls: 0 });
  const r = await W.runGrant(settled(), ctx);
  t('both bodies were fetched (headers, then body)', ['a:meta', 'a:body', 'b:meta', 'b:body'].every((f) => ctx.fetched.includes(f)), ctx.fetched);
  t('the model was never called', ctx.model.calls === 0);
  t('the format tier looked (no seed matched this prose, so it went on) and the mail was parked at the model gate', r.parked === 2 && r.held === 0 && r.staged === 0, r);
  t('the cursor advanced', r.status === 'ok' && db.calls.some((c) => c[0] === 'markSynced'), r.status);
  t('providerHasAny was asked ONCE for the provider, not once per mail', asked === 1, asked);
}

console.log('\n-- 2. the provider has no format: parked on the headers alone --');
{
  const db = memoryDb({ providerFormats: [] });
  await modelBound(db);
  const ctx = makeCtx({ db, queue: ['a'], mail, maxModelCalls: 0 });
  const r = await W.runGrant(settled(), ctx);
  t('headers fetched, body NOT fetched', ctx.fetched.join() === 'a:meta', ctx.fetched);
  t('parked, reason model_budget, cursor advanced', r.parked === 1 && db.holds.get('a').reason === 'model_budget' && r.status === 'ok', [r, [...db.holds]]);
  t('no model call', ctx.model.calls === 0);
}

console.log('\n-- 3. the same, with no parking lot: held without a fetch, exactly as before --');
{
  const db = memoryDb({ providerFormats: [], parking: false });
  await modelBound(db);
  const ctx = makeCtx({ db, queue: ['a'], mail, maxModelCalls: 0 });
  const r = await W.runGrant(settled(), ctx);
  t('held, no body fetch, cursor kept', r.held === 1 && r.status === 'held' && ctx.fetched.join() === 'a:meta' && !db.calls.some((c) => c[0] === 'markSynced'), [r, ctx.fetched]);
}

console.log('\n-- 4. a shape with NO fingerprint is fetched regardless (never gated), as before --');
{
  const db = memoryDb({ providerFormats: [] });
  const ctx = makeCtx({ db, queue: ['a'], mail, maxModelCalls: 0 });
  const r = await W.runGrant(settled(), ctx);
  t('body fetched, then parked at the model gate', ctx.fetched.includes('a:body') && r.parked === 1, [r, ctx.fetched]);
}

done();
