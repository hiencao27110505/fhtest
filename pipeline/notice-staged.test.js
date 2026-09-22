#!/usr/bin/env node
/* Mail that moves no money is staged, quietly (email-reading-v2 §6; 0147
 * email_transactions.row_kind). `node pipeline/notice-staged.test.js`
 *
 * A card due notice used to be "not a transaction": skipped, its shape cached
 * as junk, so the second one off the same shape was never read at all. Driven
 * through the real runGrant with a model that answers `mail_kind: notice`:
 *   1. it stages as row_kind 'notice', sealed, with no amount and no dedup_fp
 *   2. it is not counted pending and triggers no notification
 *   3. the opener finds mail_kind, signal and the notice block inside the box
 *   4. a repeat of the same message is skipped as already staged
 *   5. its shape is NOT cached as junk, so the next notice is read too
 *   6. db.mjs counts and lists txn rows only, and stage.mjs keeps 0068's shape
 */
import { W, nacl, makeCtx, memoryDb, mailFor, settled, reporter, NOTICE_ANSWER } from './v2-harness.mjs';
import fs from 'node:fs';
const { t, done } = reporter();
const ST = await import(new URL('../supabase/functions/_shared/mailbox/stage.mjs', import.meta.url));

const mail = (id) => mailFor(id, 'notice', 'ky 09');

console.log('\n-- 1-3. a card due notice stages as a notice row --');
const db = memoryDb();
{
  const ctx = makeCtx({ db, queue: ['n1'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: NOTICE_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('one notice, zero staged transactions, nothing skipped or unreadable', r.notices === 1 && r.staged === 0 && r.unreadable === 0 && r.skipped === 0, r);
  const row = db.staged.get('n1');
  t('the row is there with row_kind notice', row && row.row_kind === 'notice', row && Object.keys(row));
  t('sealed: every 0068 column null, the four envelope columns set', row && ST.MUST_BE_NULL_WHEN_SEALED.every((k) => row[k] == null) && row.sealed && row.eph_pub && row.nonce && row.enc_v);
  t('no dedup fingerprint, no duplicate', row && row.dedup_fp === null && row.duplicate_of_id === null, row && row.dedup_fp);
  t('occurred_at falls back to the mail\'s own date (the column is NOT NULL)', row && typeof row.occurred_at === 'string' && !isNaN(Date.parse(row.occurred_at)), row && row.occurred_at);
  t('NO NOTIFICATION: a notice is never a push', ctx.banners.length === 0 && r.notified === false, ctx.banners);
  t('tallied notice_staged, and the shape was read by the model once', db.tallies.notice_staged === 1 && db.tallies.llm_notice === 1 && ctx.model.calls === 1, db.tallies);
  t('the cursor advanced', db.calls.some((c) => c[0] === 'markSynced'));
}

console.log('\n-- 4. the same message again: skipped as already staged, no model call --');
{
  const ctx = makeCtx({ db, queue: ['n1'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: NOTICE_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  t('skipped by stagedState, never fetched', r.skipped === 1 && r.notices === 0 && ctx.fetched.length === 0 && ctx.model.calls === 0, [r, ctx.fetched]);
}

console.log('\n-- 5. its shape is not junk: the next notice of the shape is read, not hidden --');
{
  const fp = [...db.fingerprints.values()][0];
  t('the fingerprint says transaction source, no template', fp && fp.is_transaction_source === true && fp.extraction_regex == null, fp);
  const ctx = makeCtx({ db, queue: ['n2'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: NOTICE_ANSWER }) });
  const r = await W.runGrant(settled(), ctx);
  /* Read on the SAME build: the shape had its one model read (spec §11), so
     n2 is given up on rather than sent again; a new build reads it. The point
     here is that it was not answered from the junk cache. */
  t('not answered from the junk cache', !db.tallies.junk_cache && r.skipped === 0, [db.tallies, r]);
  const ctx2 = makeCtx({ db, queue: ['n3'], mail, maxModelCalls: 40, llm: () => ({ status: 200, body: NOTICE_ANSWER }), ctx: { build: 'next-build' } });
  const r2 = await W.runGrant(settled(), ctx2);
  t('on the next build the shape is read again and staged as a notice', r2.notices === 1 && db.staged.get('n3').row_kind === 'notice', r2);
}

console.log('\n-- 6. what a notice seals, through the real opener --');
{
  /* Rebuild one with a keypair we hold, so the box can be opened. */
  const crypto = await import('node:crypto');
  const kp = nacl.box.keyPair.fromSecretKey(new Uint8Array(crypto.randomBytes(32)));
  const DK = crypto.randomBytes(32).toString('base64');
  const dest = { memberId: 'm1', familyId: 'f1', ownerUserId: 'u1', scope: 'family', stagingPub: Buffer.from(kp.publicKey).toString('base64') };
  const reading = W.toReading({ mail_kind: 'notice', signal: 'card_due', notice: { due_date: '2026-09-25', min_payment: 1200000, closing_debt: 8400000 }, loan: null },
    { internalDate: Date.now(), dkim: { pass: true, result: 'pass' } });
  const row = await ST.buildStagedRow({ gmailMessageId: 'x', destination: dest, reading, rowKind: 'notice', sourceProvider: 'VIB', senderKind: 'bank', readerV: 1,
    deps: { nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle, dedupKey: DK, db: null } });
  const SB = await import(new URL('../supabase/functions/_shared/mailbox/sealed-box.mjs', import.meta.url));
  const opened = SB.openSealedRow({ ...row, family_id: 'f1' }, kp.secretKey, { nacl });
  const raw = opened && opened.raw_extracted;
  t('the box opens', !!raw, opened && Object.keys(opened));
  t('mail_kind notice, signal card_due, the notice block, no amount', raw && raw.mail_kind === 'notice' && raw.signal === 'card_due' && raw.notice && raw.notice.due_date === '2026-09-25' && raw.notice.min_payment === 1200000 && raw.amount == null && raw.direction == null && raw.flow == null, raw);
  t('even on a v1 mailbox (the kind did not exist before v2, so nothing to keep identical)', raw && raw.v === undefined && raw.mail_kind === 'notice', raw && raw.v);
  t('a txn row is byte-identical to before: no row_kind key on it', !('row_kind' in (await ST.buildStagedRow({ gmailMessageId: 'y', destination: dest,
    reading: { amount: 1, direction: 'debit', currency: 'VND', occurredAt: '2026-09-20T00:00:00Z' }, sourceProvider: 'VIB', senderKind: 'bank',
    deps: { nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle, dedupKey: DK, db: null } }))));
  let threw = null;
  try { await ST.buildStagedRow({ gmailMessageId: 'z', destination: dest, reading: { amount: null, direction: null }, sourceProvider: 'VIB', senderKind: 'bank',
    deps: { nacl, rng: crypto.webcrypto, subtle: crypto.webcrypto.subtle, dedupKey: DK, db: null } }); } catch (e) { threw = e.message; }
  t('a txn row with no amount is still refused', threw === 'STAGE_NOT_READABLE', threw);
}

console.log('\n-- 7. db.mjs counts and lists txn rows only; idempotency still sees notices --');
{
  const d = fs.readFileSync(new URL('../supabase/functions/_shared/mailbox/db.mjs', import.meta.url), 'utf8');
  t('pendingCount filters row_kind=eq.txn', /review_status=eq\.pending&row_kind=eq\.txn&/.test(d));
  t('stagedCandidates filters txn', /dedup_fp: 'eq\.' \+ q\.dedupFp,[\s\S]{0,200}row_kind: 'eq\.txn'/.test(d));
  t('familyMessageTwin filters txn', /staging_scope: 'eq\.family',\s*row_kind: 'eq\.txn'/.test(d));
  t('stagedState (the idempotency read) does NOT filter by kind', !/gmail_message_id=in\.\([\s\S]{0,80}row_kind/.test(d) && /select=gmail_message_id&' \+ \(scope \? scope \+ '&' : ''\) \+\s*'gmail_message_id=in\./.test(d));
}

done();
