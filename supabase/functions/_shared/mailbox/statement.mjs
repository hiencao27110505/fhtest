/**
 * Statement capture: a bank's statement FILE becomes one locked card.
 * (docs/specs/statement-capture-spec.md)
 *
 * A transaction email is read here, on the server, into a sealed row. A statement
 * cannot be: the file is password-locked and this process must never hold that
 * password. So the server's whole job is custody -- notice the mail, fetch the
 * attachment, seal it to the person's PERSONAL key, store it, and say "something
 * is waiting". Parsing happens on their device, after a tap.
 *
 * ITS OWN LANE, deliberately beside the transaction loop rather than inside it:
 *
 *   - Its own Gmail listing (`has:attachment`, spreadsheet filenames). The header
 *     pass in worker.mjs fetches `format=metadata`, which carries no MIME parts, so
 *     it cannot see an attachment at all; and statement mails have almost certainly
 *     been cached there as "not a transaction" already. A lane that lists for
 *     itself is untouched by the junk cache instead of racing it.
 *   - Its own cursor (`mailbox_grants.stmt_rescan_at`) and its own tombstone (the
 *     `statement_files` row, never deleted on success). It never moves, and is
 *     never held by, the transaction cursor.
 *   - Its own tiny model allowance. The project runs on the Gemini free tier, which
 *     is the pipeline's throughput ceiling; a statement must never spend the budget
 *     a live card payment is waiting for.
 *
 * A LIMIT SLOWS, NEVER LOSES. Every early return below leaves the message
 * undecided -- no row written -- so the next run meets it again.
 *
 * Every dependency is injected (db, fetch, nacl, rng, subtle, llm), like the rest
 * of this directory, so the lane runs under the Node test runner with a fake
 * Gmail and real encryption.
 */

import * as gmail from './gmail.mjs';
import * as mailtext from './mailtext.mjs';
import * as senders from './senders.mjs';
import { FH_PROVIDERS } from './providers.mjs';
import { sealForFamily, sealBytes } from './sealed-box.mjs';
import { toGeminiSchema, callGemini } from './llm.mjs';

/** The consent version that first says a statement file is stored. Must equal
 *  FH_CONSENT_V's statement bump in src/js-data/75-consent-ui.js. */
export const STATEMENT_CONSENT_V = 5;
export const STATEMENT_CONSENT_KIND = 'bank_email';

/** Sealed size ceiling. Real statements run 13-25 KB; this is a guard against a
 *  mis-attached archive, not a working limit. Matches the bucket's own limit. */
export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;

/** How many undecided statement mails one run works through, and how many of
 *  those may cost a model call. Small on purpose: see the header. */
export const STATEMENT_MAX_PER_RUN = 6;
export const STATEMENT_MODEL_CALLS_PER_RUN = 2;

export const STATEMENT_EXTS = ['xlsx', 'csv'];

/** The provider a statement row records, spelled the registry's way when the
 *  registry knows the name (account-identity-spec P4). The sender table's own
 *  canon stays as the fallback, so a name the registry has never seen keeps
 *  exactly the healing it had before. */
function providerLabel(name) {
  const hit = FH_PROVIDERS.resolve(name);
  return hit ? hit.label : senders.canonProviderName(name);
}

/** `xlsx` | `csv` | ''. By FILE NAME: banks send spreadsheets as
 *  application/octet-stream often enough that the content type says nothing. */
export function statementExt(filename) {
  const m = /\.([a-z0-9]+)\s*$/i.exec(String(filename || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return STATEMENT_EXTS.indexOf(ext) >= 0 ? ext : '';
}

/**
 * The key a statement VERDICT is cached under: the subject with every digit gone.
 *
 * Not normalizeSubjectTemplate. That one strips runs of six or more digits and
 * date shapes, and it must stay exactly as it is -- it is the cache key the
 * forwarding transport shares. But a card statement's subject is "SAO KE THE TIN
 * DUNG ... THANG 09 NAM 2026": two short numbers, a new "format" every month, and
 * a model call every month to be told the same thing. Statements get their own
 * key, in their own table, so neither rule can bend the other.
 */
export function statementShape(subject) {
  return String(subject || '')
    .replace(/^\s*((fwd|fw|re|chuyen tiep|chuyển tiếp)\s*:\s*)+/i, '')
    .replace(/\d+/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

/** The Gmail query for this lane: the same known senders, files only. */
export function statementQuery(days, domains) {
  return senders.inboxQuery(days, domains) + ' has:attachment (filename:xlsx OR filename:csv)';
}

/**
 * The period and the account tail, read locally from the mail's own words.
 * Best-effort: a card without a period falls back to the file name. No password
 * hint is ever read out of the body (decision S8).
 */
export function statementDetails(subject, body) {
  const text = String(subject || '') + '\n' + String(body || '');
  const out = {};
  const dates = text.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}\b/g) || [];
  const iso = (s) => {
    const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return null;
    return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  };
  if (dates.length >= 2 && iso(dates[0]) && iso(dates[1]) && iso(dates[0]) <= iso(dates[1])) {
    out.period_from = iso(dates[0]); out.period_to = iso(dates[1]);
  } else {
    const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const mm = /thang\s*(\d{1,2})\s*(?:nam|\/|-)\s*(\d{4})/.exec(plain);
    if (mm && +mm[1] >= 1 && +mm[1] <= 12) out.period_month = mm[2] + '-' + String(mm[1]).padStart(2, '0');
  }
  const plainAll = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const acct = /(?:so vi|so tai khoan|so the|tai khoan|account|card)\D{0,24}([\d*x]{4,})/.exec(plainAll);
  if (acct) {
    const digits = acct[1].replace(/\D/g, '');
    if (digits.length >= 4) out.account_tail = digits.slice(-4);   // the tail, never the number
  }
  return out;
}

const VERDICT_SYSTEM = 'You are shown one email from a Vietnamese bank or e-wallet that has a spreadsheet attached. ' +
  'Decide whether the attachment is an ACCOUNT STATEMENT or TRANSACTION HISTORY for the recipient ' +
  '(sao kê, lịch sử giao dịch, bảng kê giao dịch, account statement, transaction history). ' +
  'Reply as JSON {"is_statement": true|false}. ' +
  'Answer false for anything else with a spreadsheet attached: an invoice or e-invoice, a price list, a promotion, a contract, a form to fill in. ' +
  'When the email clearly says it is a statement or a list of the recipient\'s own transactions, answer true.';
const VERDICT_SCHEMA = { type: 'object', properties: { is_statement: { type: 'boolean' } }, required: ['is_statement'] };

/**
 * One model call, one boolean. `null` means "could not ask" -- rate limit,
 * transport, no key -- and the caller leaves the mail undecided. It must never be
 * read as `false`: a wrong "no" makes a statement vanish with nothing to notice.
 */
export async function statementVerdict(message, files, cfg, fetchImpl) {
  if (!cfg || !cfg.apiKey) return null;
  const r = await callGemini('statement_verdict', {
    systemInstruction: { parts: [{ text: VERDICT_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text:
      'Sender: ' + senders.addressOf(message.from) + '\nSubject: ' + message.subject +
      '\nAttached files: ' + files.map(f => f.filename).join(', ') +
      '\n\n' + String(message.body || '').slice(0, 4000) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(VERDICT_SCHEMA) },
  }, cfg, fetchImpl);
  if (r.transportError || !r.ok) return null;
  const answer = r.data && r.data.candidates && r.data.candidates[0] && r.data.candidates[0].content &&
    r.data.candidates[0].content.parts && r.data.candidates[0].content.parts[0] && r.data.candidates[0].content.parts[0].text;
  if (!answer) return null;
  try { const p = JSON.parse(answer); return typeof p.is_statement === 'boolean' ? p.is_statement : null; } catch { return null; }
}

async function _sha256Hex(bytes, subtle) {
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let s = ''; for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * The lane, for one grant.
 *
 * @param grant   the mailbox grant row
 * @param ctx     worker ctx plus { access, domains, days, backfillDays }
 * @returns {{ summary: object, messageIds: Set<string> }}
 *   `messageIds` are mails this lane owns (known or just captured statements);
 *   the transaction loop leaves them alone.
 */
export async function runStatementLane(grant, ctx) {
  const summary = { status: 'ok', listed: 0, captured: 0, rejected: 0, undecided: 0, tooLarge: 0, modelCalls: 0, rescan: false };
  const owned = new Set();
  const db = ctx.db;

  // A db built before this feature (every older test, and a worker deployed ahead
  // of its migration) has no lane. Absent is not an error.
  if (!db || !db.statementKnown || !db.insertStatementFile || !db.consentVersion) return { summary: { ...summary, status: 'off' }, messageIds: owned };
  if (!grant.user_id) return { summary: { ...summary, status: 'no_owner' }, messageIds: owned };

  // Consent first, before a single Gmail call: v4 never said a file would be kept.
  const consent = await db.consentVersion(grant.user_id, STATEMENT_CONSENT_KIND);
  if (consent < STATEMENT_CONSENT_V) return { summary: { ...summary, status: 'no_consent' }, messageIds: owned };

  // ALWAYS the personal key, whatever the grant's default scope (decision S24):
  // the file carries an ID number, a home address and a full account number.
  // Seal or hold -- a person who has never unlocked their personal ledger has no
  // key to seal to, and the mail waits.
  const personalPub = db.stagingPubForUser ? await db.stagingPubForUser(grant.user_id) : null;
  if (!personalPub) return { summary: { ...summary, status: 'held', reason: 'no_personal_staging_pub' }, messageIds: owned };

  const rescan = db.statementRescanOwed ? await db.statementRescanOwed(grant.id) : false;
  summary.rescan = rescan;
  const days = rescan ? ctx.backfillDays : ctx.days;
  const ids = await gmail.listMessageIds(statementQuery(days, ctx.domains), rescan ? 200 : 50, ctx.access, ctx.fetch);
  summary.listed = ids.length;

  // Throws when unreachable, on purpose (see db.statementKnown).
  const known = await db.statementKnown(ids, grant.user_id);
  for (const id of known) owned.add(id);
  const fresh = ids.filter(id => !known.has(id));
  const work = fresh.slice(0, ctx.statementMaxPerRun ?? STATEMENT_MAX_PER_RUN);
  let modelLeft = ctx.statementModelCalls ?? STATEMENT_MODEL_CALLS_PER_RUN;
  let limited = false;

  for (const id of work) {
    const message = await gmail.getMessage(id, ctx.access, ctx.fetch, mailtext);
    if (!message) continue;                                            // deleted between list and get
    const sender = senders.match(message.from, ctx.domains);
    if (!sender) continue;                                             // the list query is a filter, this is the check
    const files = (message.attachments || []).filter(a => statementExt(a.filename));
    if (!files.length) continue;

    const address = senders.addressOf(message.from);
    const shape = statementShape(message.subject);
    let verdict = db.statementShape ? await db.statementShape(address, shape) : null;
    if (!verdict) {
      if (modelLeft <= 0) { summary.undecided++; limited = true; continue; }
      /* The worker's gate (email-reading-v2 §10.2-3): the day's ledger and
         the pause row, asked before anything leaves the machine. A refusal is
         "decide next run", the same shape as running out of the lane's own
         allowance. Absent in older callers and tests. */
      if (ctx.spendModel && !(await ctx.spendModel('statement'))) { summary.undecided++; limited = true; continue; }
      modelLeft--; summary.modelCalls++;
      const answer = await statementVerdict(message, files, ctx.llm, ctx.fetch);
      if (answer === null) { summary.undecided++; limited = true; continue; }   // could not ask: decide next run
      verdict = { is_statement: answer };
      if (db.saveStatementShape) { try { await db.saveStatementShape(address, shape, answer, 'llm'); } catch { /* re-asked next time */ } }
    }

    const details = statementDetails(message.subject, message.body);
    const receivedAt = new Date(message.internalDate || Date.now()).toISOString();

    if (!verdict.is_statement) {
      // Remembered per MESSAGE so the mail is not fetched again every run, and
      // visible per message so a wrong "no" can be found: a spreadsheet from a
      // known bank that was judged not a statement is exactly the row to look at.
      await db.insertStatementFile({
        owner_user_id: grant.user_id, gmail_message_id: id, part_index: 0,
        source_provider: providerLabel(sender.provider), received_at: receivedAt,
        file_ext: statementExt(files[0].filename), byte_size: 0, status: 'rejected', backfill: !!rescan,
      });
      if (db.recordFailure) {
        await db.recordFailure({ gmail_message_id: id, sender: message.from, subject: message.subject,
          error_reason: 'statement_rejected:' + shape.slice(0, 80) });
      }
      summary.rejected++; owned.add(id);
      continue;
    }

    for (const file of files) {
      if (file.size > STATEMENT_MAX_BYTES) { summary.tooLarge++; continue; }
      const bytes = await gmail.getAttachment(id, file.attachmentId, ctx.access, ctx.fetch);
      if (!bytes || !bytes.length) continue;
      if (bytes.length > STATEMENT_MAX_BYTES) { summary.tooLarge++; continue; }

      // The identity of the file rides inside the sealed metadata, which binds
      // owner + message id; the blob is tied to it by the hash of its plaintext.
      const meta = sealForFamily({
        filename: file.filename, subject: message.subject, part_index: file.partIndex,
        file_sha256: await _sha256Hex(bytes, ctx.subtle), byte_size: bytes.length, ...details,
      }, personalPub, grant.user_id, id, { nacl: ctx.nacl, rng: ctx.rng }, 'personal');
      const blob = sealBytes(bytes, personalPub, { nacl: ctx.nacl, rng: ctx.rng });

      const fileId = (ctx.rng && ctx.rng.randomUUID ? ctx.rng.randomUUID() : globalThis.crypto.randomUUID());
      const path = grant.user_id + '/' + fileId + '.sealed';
      // Upload FIRST, row second: a row pointing at nothing is a card that cannot
      // open; an object with no row is an orphan the sweep removes.
      await db.uploadStatementObject(path, blob);
      const inserted = await db.insertStatementFile({
        id: fileId, owner_user_id: grant.user_id, gmail_message_id: id, part_index: file.partIndex,
        source_provider: providerLabel(sender.provider), received_at: receivedAt,
        file_ext: statementExt(file.filename), byte_size: blob.length, bytes_source: 'sealed_object',
        object_path: path, meta_sealed: meta.sealed, meta_eph_pub: meta.eph_pub, meta_nonce: meta.nonce, enc_v: meta.enc_v,
        status: 'pending', backfill: !!rescan,
      });
      if (inserted) summary.captured++;
      else if (db.deleteStatementObjects) await db.deleteStatementObjects([path]);   // lost a race: drop our copy
    }
    owned.add(id);
  }

  // The re-scan is done only when the listing was worked through with nothing
  // left undecided -- the same "cursor moves last" rule as the transaction loop.
  if (rescan && !limited && fresh.length <= work.length && db.markStatementRescanned) {
    await db.markStatementRescanned(grant.id);
  }
  if (limited || fresh.length > work.length) summary.status = 'more';

  // One push, its own wording, carrying nothing. History finds stay quiet: a
  // first connect must not open with a burst (they wait folded under "Sao kê cũ").
  if (summary.captured > 0 && !rescan && ctx.notify) {
    try { await ctx.notify(grant, summary.captured, { statement: true }); summary.notified = true; } catch { /* a push is never worth a run */ }
  }
  return { summary, messageIds: owned };
}

/**
 * Removes sealed objects that should no longer exist, a few per tick. The RPC
 * decides which (opened, dismissed, past 90 days, or an owner with no mailbox);
 * this only carries out the delete and reports back what actually went.
 */
export async function sweepStatements(ctx) {
  const db = ctx.db;
  if (!db || !db.statementSweepList || !db.deleteStatementObjects) return { swept: 0 };
  const rows = await db.statementSweepList(20);
  if (!rows.length) return { swept: 0 };
  const ok = await db.deleteStatementObjects(rows.map(r => r.object_path).filter(Boolean));
  if (ok) await db.statementSweepDone(rows.map(r => r.id));
  return { swept: ok ? rows.length : 0 };
}
