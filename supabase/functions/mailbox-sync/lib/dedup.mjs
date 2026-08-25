/**
 * Cross-source duplicate detection, direct-read side.
 *
 * The problem, unchanged by the transport: one purchase can generate two
 * emails — the bank says "debit 200.000đ", the merchant's processor says
 * "receipt 200.000đ". Both would become ledger rows and double the spending.
 * The two share no identifier at all: different reference numbers, different
 * timestamps, different wording. Only an amount. So this is a GUESS, not a
 * lookup, and every rule below exists because its absence caused a real
 * failure on the forwarding transport. docs/features/bank-email-pipeline.md §6
 * has the table of which commit paid for which clause.
 *
 * THIS FILE MUST AGREE WITH pipeline/bank-email-pipeline.gs, EXACTLY.
 *
 * The two transports write into one table and dedup against each other's rows:
 * a user whose bank forwards to the alias and whose wallet is read over OAuth
 * has both kinds of row sitting in the same queue. A fingerprint computed even
 * slightly differently here matches nothing there, and the failure is silent —
 * duplicates simply stop being caught, which reads exactly like there being
 * none. The parity test in pipeline/direct-dedup.test.js is what holds the two
 * implementations together; do not change a byte of the message string or the
 * canonicalisation list without changing it there too.
 *
 * WHY THIS SIDE NEVER MINTS THE KEY.
 *
 * The Apps Script self-mints DEDUP_FP_KEY on first use, which is right for the
 * only implementation there is. It is wrong for the second one: two independent
 * mints produce two key spaces, every fingerprint stops matching across
 * transports, and nothing anywhere throws. So the key is configuration here,
 * copied from Apps Script Properties into the worker's secrets. It stays out of
 * Supabase either way, which is the point of it — a database attacker holding
 * fingerprints cannot run a VND dictionary against them, and low-entropy VND
 * amounts are exactly what made an unkeyed hash unshippable.
 */

/** How far either side of a transaction a duplicate may sit. */
export const DEDUPE_WINDOW_DAYS = 3;

/**
 * Reduces a bank's name to something two spellings of it agree on.
 *
 * "MB Bank", "MBBank" and "MB" are one bank; comparing the raw strings called
 * two genuine MB transfers cross-source and deleted one of them. Accents are
 * folded first so "Kỹ Thương" and "Ky Thuong" meet, and the noise words are
 * stripped longest-first so "ebanking" goes before "banking" can leave a stray
 * "e" behind.
 */
export function canonicalProvider(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  // Escaped, not literal combining marks — same reason the .gs escapes them:
  // invisible characters do not survive being moved between editors reliably,
  // and a silently-broken accent fold rebuilds the same-bank bug.
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^a-z0-9]/g, '');
  const NOISE = ['internetbanking', 'mobilebanking', 'onlinebanking', 'smartbanking',
                 'ebanking', 'digibank', 'banking', 'ebank', 'bank', 'jsc'];
  for (const n of NOISE) s = s.split(n).join('');
  return s;
}

/**
 * The keyed equality token that replaces the sealed amount.
 *
 * Sealing makes `amount` NULL in the row, so an `amount = X` query matches
 * nothing — forever, and silently, which is how it shipped once. This is what
 * the range query keys on instead.
 *
 * Provider is deliberately NOT in the message. A hash matches only exactly and
 * bank names need fuzzy matching; hashing the provider would fragment on
 * spelling and rebuild the same-bank bug one layer deeper, where the loop in
 * findDuplicate could no longer see it.
 *
 * What equal fingerprints still reveal, on record: that two rows share an
 * amount and direction. Equality classes, never values.
 *
 * @param {number|string} amount
 * @param {string} direction  'debit' | 'credit'
 * @param {string} currency
 * @param {string} keyB64     DEDUP_FP_KEY, base64, from the worker's config
 * @param {object} [subtle]   WebCrypto SubtleCrypto, injected for tests
 */
export async function dedupFingerprint(amount, direction, currency, keyB64, subtle) {
  if (!keyB64) throw new Error('DEDUP_FP_KEY_MISSING');
  const crypt = subtle || (globalThis.crypto && globalThis.crypto.subtle);
  if (!crypt) throw new Error('DEDUP_NO_SUBTLE_CRYPTO');

  // String concatenation, matching the Apps Script's `'v1|' + amount + ...`.
  // Numbers stringify identically in both runtimes; `currency || ''` keeps a
  // null currency producing the same message on both sides rather than "null".
  const msg = 'v1|' + amount + '|' + direction + '|' + (currency || '');

  const raw = _unb64(keyB64);
  const key = await crypt.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypt.sign('HMAC', key, new TextEncoder().encode(msg));
  return _b64(new Uint8Array(mac));
}

/**
 * Picks the earliest staged row that looks like the same purchase as this one.
 *
 * The rule, and every clause is load-bearing:
 *
 *   same member  ∧  same amount+direction+currency  ∧  within ±3 days
 *                ∧  different canonical provider
 *
 * `same member` because the query runs on the service-role key, which bypasses
 * RLS: without it every row is compared against every member of every family,
 * and two people spending the same amount in one week is ordinary rather than
 * evidence. A genuine cross-source pair always lands on ONE member.
 *
 * `different provider` because two emails from the same bank are two pieces of
 * money, however equal — each already carries its own message id and reference.
 *
 * NOT INCLUDED HERE, on purpose: the "not both banks" clause. It needs
 * transaction_type, which is sealed and therefore unreadable to this worker.
 * The client runs the same rule with strictly more evidence — the decrypted
 * amount, the unsealed provider, transaction_type, and the real ledger to
 * compare against — in csvStagedCrossSourceDup (src/js-data/72-txn-review.js),
 * and drops a flag it can prove wrong rather than passing the tap to a person.
 *
 * The return is a SUSPICION, not a delete order. duplicate_of_id sends a row to
 * the review screen's "Có thể trùng" bucket; it must never hide one. A row
 * hidden by a wrong guess made unattended at 03:00 is the failure that cost a
 * real 2.000đ transfer once.
 *
 * @param {{amount: number, direction: string, currency: string, occurredAt: string,
 *          sourceProvider: string, memberId: string, dedupFp: string}} row
 * @param {{stagedCandidates: Function}} db
 * @return {Promise<object|null>} the row this one may duplicate
 */
export async function findDuplicate(row, db) {
  if (!row.amount || !row.occurredAt) return null;
  // An unrouted row is deduped against nothing: nobody can see it (0058), so
  // matching it against a real member's row would let an invisible row suppress
  // one somebody is waiting for.
  if (!row.memberId) return null;
  if (!row.dedupFp) return null;

  const occurred = new Date(row.occurredAt).getTime();
  const windowStart = new Date(occurred - DEDUPE_WINDOW_DAYS * 86400000).toISOString();
  const windowEnd = new Date(occurred + DEDUPE_WINDOW_DAYS * 86400000).toISOString();

  const candidates = await db.stagedCandidates({
    memberId: row.memberId,
    dedupFp: row.dedupFp,
    from: windowStart,
  });

  const mine = canonicalProvider(row.sourceProvider);
  let earliest = null;
  for (const c of candidates) {
    if (c.occurred_at > windowEnd) continue;
    const theirs = canonicalProvider(c.source_provider);
    if (theirs === mine) continue;        // same bank → a real separate transaction
    // Unknown on either side: refuse to guess. A missed duplicate costs the
    // reviewer one tap to skip it; a false one takes a real transaction out of
    // the queue and its notification with it. Those are not comparable, so the
    // tie goes to keeping the row.
    if (!theirs || !mine) continue;
    if (!earliest || c.created_at < earliest.created_at) earliest = c;
  }
  return earliest;
}

function _b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function _unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
