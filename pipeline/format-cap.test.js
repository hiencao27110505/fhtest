#!/usr/bin/env node
/* One model read per format per reader build (email-reading-v2 §11; 0147
 * sender_fingerprints.model_reads, model_read_build).
 * `node pipeline/format-cap.test.js`
 *
 * Consent v4 says a new format goes to the model "một lần". Twelve shapes paid
 * on every mail because their template could never be derived and nothing
 * remembered the question had been asked. Driven through the real
 * readTransaction with a model that never yields a learnable template:
 *   1. the same shape three times: exactly ONE model call per build; the other
 *      two come back `format_cap`, which the worker gives up on
 *   2. bump the build string: one more call, then capped again
 *   3. a read that DID learn a template resets nothing and is never capped
 *   4. no build in deps (an older caller): no cap, as before
 *   5. the worker turns format_cap into a give-up (cap 1) with its own tally
 */
import { W, makeCtx, memoryDb, mailFor, settled, reporter, TXN_ANSWER } from './v2-harness.mjs';
import crypto from 'node:crypto';
const { t, done } = reporter();
const X = await import(new URL('../supabase/functions/_shared/mailbox/extract.mjs', import.meta.url));

/* One shape: same sender, same subject; the body is prose no free tier reads. */
const shape = (n) => ({
  from: 'VIB <info@vib.com.vn>', subject: 'Thong bao giao dich',
  body: 'Quy khach vua thuc hien mot giao dich so ' + n + '. Chi tiet xem tai ung dung. Xin cam on.',
  dkim: { pass: true, result: 'pass' },
});
const deps = (db, calls, build, answer) => ({
  llm: { apiKey: 'k' }, subtle: crypto.webcrypto.subtle, build,
  fetch: async () => { calls.n++; return { ok: true, status: 200, text: async () => answer || TXN_ANSWER, json: async () => JSON.parse(answer || TXN_ANSWER) }; },
});

console.log('\n-- 1. same shape three times, one build: one model call --');
const db = memoryDb();
{
  const calls = { n: 0 };
  const r1 = await X.readTransaction(shape(1), db, deps(db, calls, 'build-A'));
  t('the first mail is read by the model', r1.ok && r1.tier === 'model' && calls.n === 1, r1);
  const fp = [...db.fingerprints.values()][0];
  t('the shape now remembers: model_reads 1, on build-A, no template', fp && fp.model_reads === 1 && fp.model_read_build === 'build-A' && fp.is_transaction_source === true && fp.extraction_regex == null, fp);
  const r2 = await X.readTransaction(shape(2), db, deps(db, calls, 'build-A'));
  const r3 = await X.readTransaction(shape(3), db, deps(db, calls, 'build-A'));
  t('the second and third are refused as format_cap', r2.ok === false && r2.reason === 'format_cap' && r3.reason === 'format_cap', [r2, r3]);
  t('...with no further model call', calls.n === 1, calls.n);
  t('tallied format_cap twice', db.tallies.format_cap === 2, db.tallies);
}

console.log('\n-- 2. a new build gets one more read --');
{
  const calls = { n: 0 };
  const r = await X.readTransaction(shape(4), db, deps(db, calls, 'build-B'));
  t('read by the model once more', r.ok && calls.n === 1, r);
  const fp = [...db.fingerprints.values()][0];
  t('the count moved on to the new build', fp.model_reads === 2 && fp.model_read_build === 'build-B', fp);
  const r2 = await X.readTransaction(shape(5), db, deps(db, calls, 'build-B'));
  t('and the next mail on build-B is capped', r2.reason === 'format_cap' && calls.n === 1, r2);
}

console.log('\n-- 3. a read that learned a template is never capped --');
{
  /* The MB table mail: the label-table tier reads it and derives a template,
     so the model is never asked and nothing is counted. */
  const db3 = memoryDb();
  const calls = { n: 0 };
  const m = mailFor('x', 'table');
  const msg = { from: 'MB <mbebanking@mbbank.com.vn>', subject: 'Thong bao thong tin giao dich TK cham',
    body: Buffer.from(m.payload.body.data, 'base64url').toString('utf8'), dkim: { pass: true, result: 'pass' } };
  const r = await X.readTransaction(msg, db3, deps(db3, calls, 'build-A'));
  const fp = [...db3.fingerprints.values()][0];
  t('read locally, template stored, nothing counted against the shape', r.ok && r.tier !== 'model' && calls.n === 0 && fp && typeof fp.extraction_regex === 'string' && !fp.model_reads, [r.tier, fp]);
  const r2 = await X.readTransaction(msg, db3, deps(db3, calls, 'build-A'));
  t('and it keeps reading', r2.ok && calls.n === 0, r2);
}

console.log('\n-- 4. no build in deps: no cap (an older caller reads as before) --');
{
  const db4 = memoryDb();
  const calls = { n: 0 };
  await X.readTransaction(shape(1), db4, deps(db4, calls, null));
  await X.readTransaction(shape(2), db4, deps(db4, calls, null));
  t('two calls, nothing recorded', calls.n === 2 && ![...db4.fingerprints.values()][0].model_reads, calls.n);
}

console.log('\n-- 5. the worker gives a format_cap mail up at once --');
{
  const db5 = memoryDb();
  const mail = (id) => mailFor(id, 'model', 'cung mot mau');
  const ctx = makeCtx({ db: db5, queue: ['a', 'b', 'c'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: TXN_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('one model call for three mails of one shape', ctx.model.calls === 1, ctx.model.calls);
  t('one staged, two given up', r.staged === 1 && r.givenUp === 2 && r.parked === 0, r);
  t('recorded with reason format_cap and cap 1, on this build', ['b', 'c'].every((id) => { const h = db5.holds.get(id); return h && h.gave_up && h.reason === 'format_cap' && h.build === W.BUILD_ID; }), [...db5.holds]);
  t('the cursor still advanced: given-ups are recorded, not held', r.status === 'ok' && db5.calls.some((c) => c[0] === 'markSynced'), r.status);
}

done();
