/**
 * Everything this worker reads and writes, in one place.
 *
 * A seam, not a wrapper for its own sake: the worker is driven end to end in
 * tests against an object literal with these methods, which is what makes an
 * "did the cursor advance when staging failed?" test possible at all.
 *
 * Everything here runs as `service_role`, which BYPASSES RLS. Two consequences
 * worth holding on to:
 *
 *   - Every query that should be scoped to one member must say so itself. The
 *     forwarding pipeline's dedup ran without a member filter for months and
 *     compared every row against every member of every family; no client could
 *     see the result, so nothing surfaced it. `stagedCandidates` below carries
 *     the filter for that reason.
 *   - `refresh_token_enc` is readable here and nowhere else. It is never
 *     selected into anything that gets returned to a caller.
 */

/** How many mailboxes one run touches. Bounds a run against a function timeout. */
/* Stamped onto every derive-failure row, so a fixed deriver's old failures age
   out visibly rather than reading as current. Imported rather than duplicated:
   two copies of a cache-keying version is how they drift. */
import { EXTRACTION_LOGIC_VERSION } from './templates.mjs';

export const MAX_GRANTS_PER_RUN = 25;

/* The subject_template of a SENDER-WIDE verdict, as opposed to a per-shape one.
   A literal no real subject can normalise to — a normalised shape is derived
   from actual subject text, and this is punctuation only. */
export const SENDER_SENTINEL = '*';

/* Whether merchant_concepts has the tree `node` column (0144). Assumed yes;
   flipped to false for the life of the process on the first put that the
   database refuses for it. See merchantConceptPut. */
let MERCHANT_NODE_COLUMN = true;

/* One value inside a PostgREST `in.(…)` list.
 *
 * Quoted, because that is what lets a value carry a space or a comma; only a
 * quote or a backslash needs escaping inside those quotes.
 *
 * DELIBERATELY NOT URL-ENCODED, and this is the whole point of the helper.
 * `fingerprint()` builds its query with URLSearchParams, which encodes every
 * value on the way out — so a value encoded here as well arrives at PostgREST
 * as its own percent-escapes ("Th%C3%B4ng%20b%C3%A1o") and is compared, as that
 * literal text, against a plain-text column. Every subject containing a space
 * missed, which is every Vietnamese bank subject there is, so the cache never
 * hit and every mail went to the model.
 *
 * `alreadyStaged` below still encodes by hand, and is right to: it concatenates
 * its query string itself, so nothing encodes it afterwards. The rule is one
 * encoding, applied once, by whoever actually writes the URL. */
export function inValue(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function createDb(url, serviceKey, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const base = url.replace(/\/$/, '') + '/rest/v1';
  const headers = {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  };

  async function rest(path, init) {
    const res = await doFetch(base + path, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error('postgrest_' + res.status + ': ' + text.slice(0, 300));
      err.status = res.status;
      // 23505 is a unique violation. The caller decides whether that is a
      // failure or the idempotency guard doing its job.
      err.isUniqueViolation = res.status === 409 || text.includes('23505');
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  async function rpc(name, args) {
    return rest('/rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
  }

  return {
    rest,
    rpc,

    /**
     * Mailboxes worth polling now.
     *
     * `needs_reauth` is excluded here as well as checked in identity.mjs: a
     * dead token cannot mint an access token, so polling one only burns a call
     * and writes a log line about a state the app already knows.
     */
    async dueGrants(limit) {
      const qs = new URLSearchParams({
        select: 'id,user_id,member_id,family_id,provider,email,refresh_token_enc,scopes,needs_reauth,history_id,last_synced_at,backfilled_at,connected_at,default_scope,backfill_days,stalled_runs,first_stalled_at,backfill_before,backfill_started_at',
        needs_reauth: 'eq.false',
        // Direction spelled out: PostgREST's order grammar is
        // `col.dir.nullsorder`, and a bare `.nullsfirst` is not reliably parsed.
        // Oldest poll first, never-polled before that.
        order: 'last_synced_at.asc.nullsfirst',
        limit: String(limit || MAX_GRANTS_PER_RUN),
      });
      return (await rest('/mailbox_grants?' + qs.toString())) || [];
    },

    /**
     * One grant by id, for the connect-time kick (worker.runOne).
     *
     * Same columns and the same needs_reauth filter as dueGrants, so a grant
     * this returns is exactly one dueGrants would have offered — the kick can
     * never run a mailbox the poll would refuse.
     */
    async grantById(id) {
      const qs = new URLSearchParams({
        select: 'id,user_id,member_id,family_id,provider,email,refresh_token_enc,scopes,needs_reauth,history_id,last_synced_at,backfilled_at,connected_at,default_scope,backfill_days,stalled_runs,first_stalled_at,backfill_before,backfill_started_at',
        id: 'eq.' + id,
        needs_reauth: 'eq.false',
        limit: '1',
      });
      const rows = await rest('/mailbox_grants?' + qs.toString());
      return (rows && rows[0]) || null;
    },

    /**
     * EVERY grant for one mailbox address, for a push or an ingest to resolve.
     *
     * Plural since 0137: a mailbox may have more than one reader (two accounts
     * of one person, or two people sharing an inbox), and each one is a separate
     * queue. Returning the first, as this did under `limit: 1`, would ring only
     * one of them and leave the other waiting for the next poll.
     *
     * Two lookups, not one: the exact address first, then the Gmail-folded
     * form. Google returns the canonical address in both the profile call and
     * the push, so the first should always hit — but a miss here is a
     * notification silently dropped for a mailbox we do hold, which is
     * indistinguishable from a quiet mailbox. The forwarding pipeline was
     * bitten by exactly this. The fallback costs one query on a path that
     * already failed.
     */
    async grantsByEmail(email, folded) {
      const q = e => new URLSearchParams({
        select: 'id,user_id,member_id,family_id,provider,email,refresh_token_enc,scopes,needs_reauth,history_id,last_synced_at,backfilled_at,watch_expires_at,default_scope,backfill_days,stalled_runs,first_stalled_at,backfill_before,backfill_started_at',
        email: 'eq.' + e,
        needs_reauth: 'eq.false',
        order: 'connected_at.asc',
      });
      let rows = await rest('/mailbox_grants?' + q(email).toString());
      if ((!rows || !rows.length) && folded && folded !== email) {
        rows = await rest('/mailbox_grants?' + q(folded).toString());
      }
      return rows || [];
    },

    /** Records a fresh watch registration. `expiresAt` is epoch milliseconds. */
    async saveWatch(grantId, expiresAt) {
      await rest('/mailbox_grants?id=eq.' + grantId, {
        method: 'PATCH',
        body: JSON.stringify({
          watch_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          updated_at: new Date().toISOString(),
        }),
      });
    },

    /**
     * Mailboxes whose watch lapses within `withinSeconds`, soonest first.
     *
     * A watch lasts 7 days and the sweep runs far more often than that, so
     * renewing everything on every run would repeat work that is good for
     * another six — and with enough mailboxes the run stops fitting, leaving
     * the tail of the list to lapse SILENTLY, which is the exact failure this
     * job exists to prevent. Asking for what is actually due keeps the work
     * proportional to what expires rather than to how many users exist.
     *
     * A mailbox with no watch is due by definition.
     */
    async watchesDue(withinSeconds, limit) {
      const cutoff = new Date(Date.now() + withinSeconds * 1000).toISOString();
      const qs = new URLSearchParams({
        select: 'id,email,refresh_token_enc,needs_reauth,watch_expires_at',
        needs_reauth: 'eq.false',
        or: '(watch_expires_at.is.null,watch_expires_at.lte.' + cutoff + ')',
        order: 'watch_expires_at.asc.nullsfirst',
        limit: String(limit || 25),
      });
      return (await rest('/mailbox_grants?' + qs.toString())) || [];
    },

    /* A backfill run that staged nothing new, counted (0101).
    
       Two fields because "stuck for 40 runs" and "stuck since 09:12" answer
       different questions, and the second is the one that tells a human whether
       this is a blip or a rotated API key. `first_stalled_at` is only written
       on the FIRST stall of a streak, so it keeps meaning "since when".
    
       Best-effort throughout: this is bookkeeping about a run that already
       decided what it was doing, and failing to record a stall must never fail
       the run that noticed it. */
    async recordStall(grantId, runs, firstStalledAt) {
      try {
        const patch = { stalled_runs: runs, updated_at: new Date().toISOString() };
        if (firstStalledAt) patch.first_stalled_at = firstStalledAt;
        await rest('/mailbox_grants?id=eq.' + encodeURIComponent(grantId), {
          method: 'PATCH', body: JSON.stringify(patch),
        });
      } catch { /* bookkeeping, never fatal */ }
    },

    /* Progress clears the streak. Called only when a run actually staged
       something, so a mailbox that recovers stops looking stuck immediately. */
    async clearStall(grantId) {
      try {
        await rest('/mailbox_grants?id=eq.' + encodeURIComponent(grantId), {
          method: 'PATCH',
          body: JSON.stringify({ stalled_runs: 0, first_stalled_at: null }),
        });
      } catch { /* ditto */ }
    },

    /* The backfill position (0136). Not swallowed here: the worker catches and
       logs it, because a lost position costs one repeated slice and nothing more. */
    async advanceBackfill(grantId, fields) {
      await rest('/mailbox_grants?id=eq.' + encodeURIComponent(grantId), {
        method: 'PATCH',
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
      });
    },

    /* The mailbox lease (0145). Every one of these is best-effort at the call
       site: a lease that cannot be taken, renewed or released must never be the
       reason a mailbox goes unread. */
    async takeMailboxLease(grantId, ttlS) {
      const out = await rest('/rpc/take_mailbox_lease', {
        method: 'POST',
        body: JSON.stringify({ p_grant: grantId, p_ttl_s: ttlS || 90 }),
      });
      return (out && typeof out === 'string') ? out : (out || null);
    },

    async renewMailboxLease(grantId, lease, ttlS) {
      return await rest('/rpc/renew_mailbox_lease', {
        method: 'POST',
        body: JSON.stringify({ p_grant: grantId, p_lease: lease, p_ttl_s: ttlS || 90 }),
      });
    },

    async releaseMailboxLease(grantId, lease) {
      await rest('/rpc/release_mailbox_lease', {
        method: 'POST',
        body: JSON.stringify({ p_grant: grantId, p_lease: lease }),
      });
    },

    async markNeedsReauth(grantId) {
      await rest('/mailbox_grants?id=eq.' + grantId, {
        method: 'PATCH',
        body: JSON.stringify({ needs_reauth: true, updated_at: new Date().toISOString() }),
      });
    },

    /**
     * Cursor and sync bookkeeping, written LAST in a run.
     *
     * `historyId` is accepted but the poll does not depend on it: this worker
     * pages by search query and message id, and keeps the value only so a later
     * move to push has a starting point rather than replaying a mailbox.
     */
    async markSynced(grantId, fields) {
      await rest('/mailbox_grants?id=eq.' + grantId, {
        method: 'PATCH',
        body: JSON.stringify({
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(fields || {}),
        }),
      });
    },

    async memberById(id) {
      const rows = await rest('/members?select=id,family_id,archived_at&id=eq.' + id);
      return (rows && rows[0]) || null;
    },

    /* The PERSON's staging public key (0091). Separate lookup from the family's
       because they are separate keys with separate lifecycles: a family key is
       minted when any family device unlocks, this one only when its owner does.
       Only the public half is granted to service_role — the worker seals to a
       person and can never unwrap what it sealed. */
    async stagingPubForUser(userId) {
      if (!userId) return null;
      const rows = await rest('/personal_keys?select=staging_pub&user_id=eq.' + encodeURIComponent(userId));
      return (rows && rows[0] && rows[0].staging_pub) || null;
    },
    async stagingPubForFamily(familyId) {
      const rows = await rest('/family_keys?select=staging_pub&family_id=eq.' + familyId);
      return (rows && rows[0] && rows[0].staging_pub) || null;
    },

    /** The shared classification cache, keyed on sender AND subject template. */
    /* Both verdicts for this mail in ONE query: the exact (sender, subject shape)
       and the sender-wide sentinel.

       The sentinel exists because the per-shape cache is useless against a
       marketing sender. A promotional mail has a new subject every time, so the
       shape never repeats, the cache never hits, and EVERY message costs a model
       call to be told again that it is not a transaction. One real mailbox spent
       58 calls that way on two VIB marketing subdomains that have never sent a
       transaction.

       Asked together rather than in sequence because the sentinel matters
       exactly when the exact lookup misses, which is the common case for those
       senders — a second round trip there would put a network hop in front of
       every junk mail. */
    async fingerprint(sender, template) {
      sender = String(sender || '').toLowerCase();   // the cache key is case-blind, whoever calls
      const qs = new URLSearchParams({
        select: 'sender_address,subject_template,is_transaction_source,transaction_type,extraction_regex,last_verified_at',
        sender_address: 'eq.' + sender,
        subject_template: 'in.(' + [template, SENDER_SENTINEL].map(inValue).join(',') + ')',
      });
      const rows = (await rest('/sender_fingerprints?' + qs.toString())) || [];
      const exact = rows.find(r => r.subject_template === template) || null;
      const sentinel = rows.find(r => r.subject_template === SENDER_SENTINEL) || null;
      // The exact shape always wins: a sender can be mostly noise and still have
      // one template worth reading, and that row is the more specific answer.
      if (exact) return exact;
      return sentinel ? { ...sentinel, _sender_wide: true } : null;
    },

    /* Every fingerprint for a set of senders, in ONE query (2026-08-29).
    
       `fingerprint()` above is a round trip per message, and a backfill is
       hundreds of messages against a handful of distinct senders — so the same
       few rows were fetched over and over. The worker now warms this once per
       window and answers from memory, which took a 228-message backfill from
       228 lookups to one.
    
       Returns a Map keyed `sender\u0000subject_template`, holding the same row
       shape `fingerprint()` returns so the caller can share one code path. The
       sentinel rows come back under the `*` key and the caller applies the same
       exact-beats-sentinel rule. */
    async fingerprintsForSenders(senderAddresses) {
      const list = [...new Set((senderAddresses || []).filter(Boolean))];
      if (!list.length) return new Map();
      const out = new Map();
      // Chunked: a URL has a length limit and a busy window can touch many
      // senders. 40 keeps the query string well inside every proxy's ceiling.
      for (let i = 0; i < list.length; i += 40) {
        const chunk = list.slice(i, i + 40);
        const qs = new URLSearchParams({
          select: 'sender_address,subject_template,is_transaction_source,transaction_type,extraction_regex,last_verified_at',
          sender_address: 'in.(' + chunk.map(inValue).join(',') + ')',
        });
        const rows = (await rest('/sender_fingerprints?' + qs.toString())) || [];
        for (const r of rows) out.set(r.sender_address + '\u0000' + r.subject_template, r);
      }
      return out;
    },

    /* How much this sender has cost, and whether it has ever paid off.
       Only asked after a model call has already decided "not a transaction", so
       it is one query per NEW junk shape rather than per message. */
    async senderTally(sender) {
      sender = String(sender || '').toLowerCase();
      const qs = new URLSearchParams({
        select: 'is_transaction_source',
        sender_address: 'eq.' + sender,
        subject_template: 'neq.' + SENDER_SENTINEL,
      });
      const rows = (await rest('/sender_fingerprints?' + qs.toString())) || [];
      return {
        junk: rows.filter(r => r.is_transaction_source === false).length,
        txn: rows.filter(r => r.is_transaction_source === true).length,
      };
    },

    async saveFingerprint(row) {
      row = { ...row, sender_address: String(row.sender_address || '').toLowerCase() };
      await rest('/sender_fingerprints?on_conflict=sender_address,subject_template', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
    },

    /* Category cascade (classify.mjs). Three thin reads/writes keyed by a hashed,
       gateway-normalized merchant key — no merchant name or amount lives in
       either table. All best-effort: the caller treats any throw as "no answer"
       and falls to generic copy, so a cache blip never blocks staging. */
    /* Both reads select `*` rather than naming columns: the tree `node` column
       (0144) may not be applied yet where this code runs first, and a named
       select of a missing column is a 400 on EVERY lookup — which the caller
       reads as "no answer" and pays a model call for, per merchant, per run.
       `*` returns whatever columns exist; the caller reads `node` if present. */
    async merchantCorrectionGet(userId, hash) {
      const rows = await rest('/merchant_corrections?owner_user_id=eq.' + encodeURIComponent(userId) +
        '&merchant_hash=eq.' + encodeURIComponent(hash) + '&select=*&limit=1');
      if (!rows || !rows[0]) return null;
      // {concept, node} — classify.mjs also still accepts the old bare string.
      return { concept: rows[0].concept ?? null, node: rows[0].node ?? null };
    },
    async merchantConceptGet(hash) {
      // Returns the ROW (or null) so the caller can tell "no row = never tried"
      // apart from "row with null concept = tried and unknowable". `pool` is the
      // finer sub-kind (coffee/milktea/ride/cinema) or null; `node` (0144) the
      // tree code, or null / absent on a row (or schema) that predates it.
      const rows = await rest('/merchant_concepts?merchant_hash=eq.' + encodeURIComponent(hash) +
        '&select=*&limit=1');
      return rows && rows.length ? rows[0] : null;
    },
    async merchantConceptPut(hash, concept, pool, node) {
      const row = { merchant_hash: hash, concept: concept ?? null, pool: pool ?? null, source: 'llm', updated_at: new Date().toISOString() };
      const put = (r) => rest('/merchant_concepts?on_conflict=merchant_hash', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(r),
      });
      if (!MERCHANT_NODE_COLUMN) { await put(row); return; }
      try { await put({ ...row, node: node ?? null }); }
      catch (e) {
        /* A 400 naming the column means 0144 is not applied here yet. Retry
           without it — the concept/pool cache must keep working, or every
           merchant pays a model call per run — and remember, so the rest of
           this process does not pay a failed round-trip per put. */
        if (e && e.status === 400 && /node/.test(String(e.message))) {
          MERCHANT_NODE_COLUMN = false;
          await put(row);
          return;
        }
        throw e;
      }
    },

    /* One usage row per LLM call (llm_calls, migration 0128). Content-free —
       feature, model, outcome, the API's own token counts, latency. Best-effort:
       callGemini awaits this inside a try/catch, so a throw here is invisible. */
    async recordLlmCall(rec) {
      await rest('/llm_calls', {
        method: 'POST',
        body: JSON.stringify({
          feature: rec.feature,
          model: rec.model || null,
          outcome: rec.outcome,
          status_code: rec.status_code ?? null,
          prompt_tokens: rec.prompt_tokens ?? null,
          output_tokens: rec.output_tokens ?? null,
          total_tokens: rec.total_tokens ?? null,
          latency_ms: rec.latency_ms ?? null,
        }),
      });
    },

    /* Best-effort telemetry — never awaited into a failure. bump_read_tally is
       one upsert per read naming the tier that answered; extract_miss_labels
       records the label vocabulary of a transaction the table tier could not
       read (labels only — the values never leave the mail). A throw here must
       cost nothing but the data point. */
    /* WHY a shape could not learn a template — the counterpart to
       `template_missed`, which says only THAT one exists and never matches.
       Counted per (sender, subject, step, logic_version), never one row per
       event: a shape that fails does so on every mail of that shape, and an
       event log would be a flood bounded by mail volume rather than by the
       number of shapes. `logic_version` is what lets a fixed deriver's old
       failures age out visibly instead of polluting the picture forever.
       Best-effort like the tally above: instrumenting a failure must never
       create one. */
    /* One probe run's verdicts, replacing last week's. These are SNAPSHOTS,
       not counters — overwrite is the correct semantics, unlike the two
       counting RPCs. Domain + counts only, aggregated in memory by the caller:
       no subjects, no addresses, no per-user rows can reach this table because
       the row shape has nowhere to put them. */
    async saveCoverageCandidates(rows) {
      if (!rows || !rows.length) return;
      try {
        await rest('/coverage_candidates?on_conflict=domain', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows.map((r) => ({
            domain: r.domain, mailboxes: r.mailboxes, messages: r.messages,
            last_seen: new Date().toISOString(),
          }))),
        });
      } catch { /* a lost snapshot is next week's snapshot */ }
    },

    /* Confirmed learned label mappings, loaded ONCE per run. n >= 3 is the
       confirmation threshold — one mail where a value happens to equal a field
       is a coincidence; three from the same domain is a layout. The field
       allowlist is enforced here as well as at learning time: two mechanisms
       have to fail before a learned mapping can steer amount or occurred_at. */
    async loadLearnedLabels() {
      const SAFE = new Set(['memo', 'reference', 'merchant', 'beneficiary']);
      const byDomain = new Map();
      try {
        const rows = (await rest('/learned_labels?select=label_norm,field,sender_domain&n=gte.3&limit=500')) || [];
        for (const r of rows) {
          if (!SAFE.has(r.field)) continue;
          const d = String(r.sender_domain || '').toLowerCase();
          if (!byDomain.has(d)) byDomain.set(d, new Map());
          const m = byDomain.get(d);
          // A label claiming two fields is a bad signal: apply NEITHER.
          if (m.has(r.label_norm) && m.get(r.label_norm) !== r.field) m.set(r.label_norm, null);
          else if (!m.has(r.label_norm)) m.set(r.label_norm, r.field);
        }
        for (const m of byDomain.values()) for (const [k, v] of m) if (v === null) m.delete(k);
      } catch { /* no learning is exactly the hand-authored behaviour */ }
      return byDomain;
    },

    /* One vote: this label meant this field, in a mail from this domain.
       An RPC, not an upsert — merge-duplicates cannot increment (0111). */
    async recordLearnedLabel(domain, label, field) {
      try {
        await rest('/rpc/record_learned_label', {
          method: 'POST',
          body: JSON.stringify({ p_domain: domain, p_label: label, p_field: field }),
        });
      } catch { /* a lost vote is not a lost transaction */ }
    },

    async recordDeriveFailure(sender, subjectTemplate, step) {
      /* Through the RPC, not merge-duplicates (0111): merge-duplicates UPDATES
         only the payload's columns, `n` was never in the payload, and so the
         counter counted to one forever. Found while planning the learned-labels
         work; the RPC is the same shape bump_read_tally has always used. */
      try {
        await rest('/rpc/record_derive_failure', {
          method: 'POST',
          body: JSON.stringify({
            p_sender: String(sender || '').toLowerCase(),
            p_subject: subjectTemplate,
            p_step: step,
            p_version: EXTRACTION_LOGIC_VERSION,
          }),
        });
      } catch { /* a lost data point is not a lost transaction */ }
    },

    async bumpReadTally(stage) {
      try {
        await rest('/rpc/bump_read_tally', {
          method: 'POST',
          body: JSON.stringify({ p_stage: String(stage || 'unknown').slice(0, 32) }),
        });
      } catch { /* the read stands regardless */ }
    },

    async logMissLabels(sender, labels) {
      try {
        if (!labels || !labels.length) return;
        await rest('/extract_miss_labels', {
          method: 'POST',
          body: JSON.stringify({
            sender_address: String(sender || '').toLowerCase(),
            labels: labels.slice(0, 24),
          }),
        });
      } catch { /* ditto */ }
    },


    /** Bank domains, if anyone has seeded them. Empty is the normal case. */
    /* Whole-sender junk verdicts that are safe to push into the Gmail query.
       A sender qualifies only when it has a '*' verdict of "never a transaction
       source" AND no parse shape of its own, so the query can never hide a real
       transaction. Two small reads intersected here rather than one SQL
       statement: PostgREST has no NOT EXISTS, and both sets are hundreds of
       rows. Any failure returns [] — the query then lists exactly as before,
       which is only slower, never wrong. */
    async skipSenders() {
      try {
        const wide = await rest('/sender_fingerprints?select=sender_address&subject_template=eq.*&is_transaction_source=is.false');
        if (!wide || !wide.length) return [];
        const parse = await rest('/sender_fingerprints?select=sender_address&is_transaction_source=is.true');
        const keep = new Set((parse || []).map(r => String(r.sender_address || '').toLowerCase()));
        return [...new Set(wide.map(r => String(r.sender_address || '').toLowerCase()))]
          .filter(a => a && !keep.has(a));
      } catch {
        return [];
      }
    },

    async providerDomains() {
      try {
        return (await rest('/known_provider_domains?select=domain_or_address,provider_name&active=eq.true')) || [];
      } catch {
        // A table this worker does not depend on must not be able to stop a run.
        return [];
      }
    },

    /**
     * Which of these message ids are already staged.
     *
     * Asked in ONE query before any of them is fetched, so a poll that re-reads
     * a window costs one round trip rather than one per message. A throw here is
     * deliberately not swallowed by the caller: if the database is unreachable,
     * concluding "not staged" inserts a second copy of every transaction in the
     * window.
     */
    /* "Have we finished with this message?" — which is NOT the same question as
       "is it in email_transactions?", and the difference is what let a widened
       backfill re-stage 42 transactions a person had already promoted.

       A promotion DELETES the staged row (resolve_email_transactions), so the
       table alone forgets. `resolved_email_messages` (0090) is the other half:
       it keeps the message id and nothing else, so a re-read of an old window
       skips mail the person is done with.

       Both are asked in one pass, and a failure of either must THROW rather
       than return an empty set. Failing open here stages everything twice. */
    /* The two halves ANSWERED SEPARATELY (0113): `staged` — the id is sitting
       in email_transactions right now; `resolved` — a tombstone remembers it
       was promoted or dismissed, mapped to WHEN, because the worker re-stages
       prior-epoch tombstones during a backfill (the "đã nhập trước đó" badge)
       and must tell those apart from a tombstone written five minutes ago.
       alreadyStaged below keeps the union shape for the ingest path, whose
       relay-minted ids never match a tombstone anyway. */
    async stagedState(messageIds, memberId, ownerUserId) {
      const out = { staged: new Set(), resolved: new Map() };
      if (!messageIds.length) return out;

      /* CHUNKED, and the chunk size is the whole point (2026-08-29).
      
         This used to put every listed id into one `in.(…)` URL. At 90 days that
         is ~230 ids and about 5KB, which works; at 365 days it is 800+ and about
         19KB, which Cloudflare rejects with a bare HTTP/2 stream error. The throw
         landed before any message was read, so a 365-day backfill produced no
         rows, no read tally, no stall counter and no cursor move — it looked
         exactly like a mailbox that had nothing in it. Found on a real connect.
      
         150 ids is ~2.9KB of query string, comfortably inside every proxy limit
         with room for the base URL, and costs one extra round trip per 150
         messages — nothing against the per-message fetches that follow. */
      const CHUNK = 150;

      // Scoped by owner where there is one, member otherwise. Since 0092 the
      // tombstone table is KEYED on owner — a personal-only user has no member
      // to key on, and a tombstone that cannot be written is a message that
      // comes back on every wide read forever. Asking unscoped would be worse
      // than not asking: one person's decision would hide another's mail.
      const scope = ownerUserId
        ? 'owner_user_id=eq.' + encodeURIComponent(ownerUserId)
        : (memberId ? 'member_id=eq.' + encodeURIComponent(memberId) : null);

      for (let i = 0; i < messageIds.length; i += CHUNK) {
        // Each id is encoded on its own and the commas stay literal. Encoding
        // the joined string instead turns the SEPARATORS into %2C, which happens
        // to survive PostgREST's decode today but makes the query's meaning
        // depend on decode order rather than on what was written.
        const list = messageIds.slice(i, i + CHUNK)
          .map(id => '"' + encodeURIComponent(id) + '"').join(',');

        /* "Have we finished with this message?" — which is NOT the same question
           as "is it in email_transactions?", and the difference is what let a
           widened backfill re-stage 42 transactions a person had already
           promoted. A promotion DELETES the staged row, so the table alone
           forgets; `resolved_email_messages` (0090) keeps the id and nothing
           else. Both are asked, and a failure of either must THROW rather than
           return an empty set — failing open here stages everything twice. */
        /* SCOPED TO THE READER (0137), like the tombstones below. Unscoped, this
           asked "has ANY account staged this id?", which under two readers of
           one mailbox meant the first reader's row made the second skip the
           mail: the split feed 0103 recorded. With no scope at all (an unrouted
           row) the old unscoped question is the only one there is. */
        const staged = await rest(
          '/email_transactions?select=gmail_message_id&' + (scope ? scope + '&' : '') +
          'gmail_message_id=in.(' + list + ')');
        for (const r of (staged || [])) out.staged.add(r.gmail_message_id);

        if (scope) {
          const resolved = await rest(
            '/resolved_email_messages?select=gmail_message_id,resolved_at&' + scope +
            '&gmail_message_id=in.(' + list + ')');
          for (const r of (resolved || [])) out.resolved.set(r.gmail_message_id, r.resolved_at || null);
        }
      }
      return out;
    },

    /* Union view for the ingest path: "have we finished with this message?".
       Kept because a forwarded mail is staged under the RELAY's message id —
       it can never match a tombstone from a previous life, so the re-stage
       nuance above buys nothing there and the simple set stays honest. */
    async alreadyStaged(messageIds, memberId, ownerUserId) {
      const s = await this.stagedState(messageIds, memberId, ownerUserId);
      const done = new Set(s.staged);
      for (const id of s.resolved.keys()) done.add(id);
      return done;
    },

    /* How many rows are waiting for this person, exactly.
    
       Asked once per mailbox in its lifetime — when a backfill finishes — so the
       one notification that read can honestly say how much arrived. A running
       total threaded through the runs would drift the moment a run failed
       halfway; counting at the end cannot. Uses a HEAD request with an exact
       count, so nothing is transferred but the number. */
    async pendingCount(memberId, ownerUserId) {
      const scope = ownerUserId
        ? 'owner_user_id=eq.' + encodeURIComponent(ownerUserId)
        : (memberId ? 'member_id=eq.' + encodeURIComponent(memberId) : null);
      if (!scope) return 0;
      const res = await doFetch(
        base + '/email_transactions?select=id&review_status=eq.pending&' + scope,
        { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } });
      const range = res.headers.get('content-range') || '';
      const n = Number(String(range).split('/')[1]);
      return Number.isFinite(n) ? n : 0;
    },

    /** Candidate duplicates: same member, same fingerprint, within the window. */
    async stagedCandidates(q) {
      const qs = new URLSearchParams({
        select: 'id,source_provider,occurred_at,created_at',
        member_id: 'eq.' + q.memberId,
        dedup_fp: 'eq.' + q.dedupFp,
        occurred_at: 'gte.' + q.from,
        duplicate_of_id: 'is.null',
      });
      return (await rest('/email_transactions?' + qs.toString())) || [];
    },

    /**
     * A family row for the same message, staged for ANOTHER member of the same
     * family (0137: one household inbox, two readers). Oldest first, so every
     * later copy points at the same original. Family rows only: a personal row
     * belongs to one person's ledger and is never someone else's duplicate.
     */
    async familyMessageTwin(q) {
      const members = (await rest('/members?' + new URLSearchParams({
        select: 'id', family_id: 'eq.' + q.familyId,
      }).toString())) || [];
      const others = members.map(m => m.id).filter(id => id && id !== q.memberId);
      if (!others.length) return null;
      const rows = (await rest('/email_transactions?' + new URLSearchParams({
        select: 'id,created_at',
        gmail_message_id: 'eq.' + q.gmailMessageId,
        staging_scope: 'eq.family',
        member_id: 'in.(' + others.join(',') + ')',
        order: 'created_at.asc',
        limit: '1',
      }).toString())) || [];
      return rows[0] || null;
    },

    /**
     * Inserts one staged row.
     *
     * A unique violation on `(owner_user_id, gmail_message_id)` (0137) returns
     * false rather than throwing: it means another run staged this message for
     * the same reader between our check and our insert, which is the guard
     * working, not a failure.
     */
    async insertStaged(row) {
      try {
        await rest('/email_transactions', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(row),
        });
        return true;
      } catch (e) {
        if (e.isUniqueViolation) return false;
        throw e;
      }
    },

    /**
     * Records a mail we could not read, for triage.
     *
     * `raw_body` is deliberately NOT written. Since 0068 the forwarding pipeline
     * stopped storing it here too: a failure row holding a full plaintext email
     * is a side door around everything the sealed table protects.
     */
    async recordFailure(row) {
      try {
        await rest('/parse_failures', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      } catch {
        // Triage must never be able to fail a run.
      }
    },

    /* ── statement capture (statement.mjs, docs/specs/statement-capture-spec.md) ──
       Appended as one block on purpose: every method here is new, none changes an
       existing one, and a run whose `db` lacks them (every test written before
       2026-09-19) simply has no statement lane. */

    /**
     * The newest version of a consent kind this person has affirmed, or 0.
     *
     * The FIRST server-side read of `user_consents`. Transaction mail never needed
     * one: the client refuses to create a grant without consent, so a grant's
     * existence was the proof. A statement is different -- the grant already
     * exists under v4, and v4 never said a file would be stored. So the worker
     * asks. A failed read is 0 (no consent), the closed direction.
     */
    async consentVersion(userId, kind) {
      if (!userId) return 0;
      try {
        const rows = await rest('/user_consents?select=version&user_id=eq.' + encodeURIComponent(userId) +
          '&kind=eq.' + encodeURIComponent(kind) + '&order=version.desc&limit=1');
        return rows && rows[0] ? Number(rows[0].version) || 0 : 0;
      } catch { return 0; }
    },

    /**
     * Which of these messages this OWNER already has a statement decision for --
     * captured, opened, dismissed, expired or rejected alike. The row is never
     * deleted on success, so it is its own tombstone. Must THROW when unreachable:
     * "not known" would fetch, seal and store every attachment again.
     */
    async statementKnown(messageIds, ownerUserId) {
      const known = new Set();
      if (!messageIds || !messageIds.length || !ownerUserId) return known;
      for (let i = 0; i < messageIds.length; i += 150) {
        const chunk = messageIds.slice(i, i + 150);
        const rows = await rest('/statement_files?select=gmail_message_id&owner_user_id=eq.' + encodeURIComponent(ownerUserId) +
          '&gmail_message_id=in.(' + chunk.map(inValue).join(',') + ')');
        for (const r of rows || []) known.add(r.gmail_message_id);
      }
      return known;
    },

    /** The cached "is this mail format a statement?" verdict, or null when the
     *  format has never been judged. Global: one judgement serves every user. */
    async statementShape(sender, shape) {
      const rows = await rest('/statement_shapes?select=is_statement&sender_address=eq.' + encodeURIComponent(sender) +
        '&shape=eq.' + encodeURIComponent(shape) + '&limit=1');
      return rows && rows[0] ? { is_statement: rows[0].is_statement === true } : null;
    },

    async saveStatementShape(sender, shape, isStatement, source) {
      await rest('/statement_shapes?on_conflict=sender_address,shape', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ sender_address: sender, shape, is_statement: !!isStatement, source: source || 'llm' }),
      });
    },

    /** One captured attachment. A unique violation is `false`, not a throw: two
     *  runs racing on one message is the idempotency guard doing its job. */
    async insertStatementFile(row) {
      try {
        await rest('/statement_files', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
        return true;
      } catch (e) {
        if (e.isUniqueViolation) return false;
        throw e;
      }
    },

    /**
     * The first server-side Storage write in this codebase. Same service-role
     * headers, different root (`/storage/v1`), raw bytes as the body. `x-upsert`
     * so a retry after a crash between upload and insert overwrites its own
     * orphan instead of failing on it.
     */
    async uploadStatementObject(path, bytes) {
      const res = await doFetch(url.replace(/\/$/, '') + '/storage/v1/object/statement-files/' + path.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        body: bytes,
      });
      if (!res.ok) throw new Error('storage_' + res.status + ': ' + (await res.text()).slice(0, 200));
    },

    /** Best-effort by design: a delete that fails is retried by the next sweep. */
    async deleteStatementObjects(paths) {
      if (!paths || !paths.length) return false;
      try {
        const res = await doFetch(url.replace(/\/$/, '') + '/storage/v1/object/statement-files', {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: paths }),
        });
        return res.ok;
      } catch { return false; }
    },

    /** Files whose sealed object should no longer exist: opened or dismissed (the
     *  device deletes its own, this is the net), past their 90 days, or owned by
     *  someone who no longer has a mailbox connected. Picked by the RPC so the rule
     *  lives in one place (0140). */
    async statementSweepList(limit) {
      try { return (await rpc('statement_sweep_list', { p_limit: limit || 20 })) || []; } catch { return []; }
    },

    async statementSweepDone(ids) {
      if (!ids || !ids.length) return;
      try { await rpc('statement_sweep_done', { p_ids: ids }); } catch { /* next sweep */ }
    },

    /** Pending statement cards for one owner -- the count the push is allowed to
     *  act on (never shown: the push carries no number). */
    async pendingStatementCount(ownerUserId) {
      if (!ownerUserId) return 0;
      const res = await doFetch(base + '/statement_files?select=id&status=eq.pending&owner_user_id=eq.' + encodeURIComponent(ownerUserId), {
        method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' },
      });
      const range = res.headers && res.headers.get ? res.headers.get('content-range') : '';
      const n = Number(String(range || '').split('/')[1]);
      return Number.isFinite(n) ? n : 0;
    },

    /**
     * Whether this grant still owes its one-time statement re-scan of history.
     * Its OWN query, not a column added to dueGrants/grantById/grantsByEmail: those
     * three select lists are edited by other work in flight, and a lane that reads
     * its own cursor cannot be broken by, or break, a change to theirs. A failed
     * read is "done" -- the closed direction is "do not re-read a year of mail".
     */
    async statementRescanOwed(grantId) {
      try {
        const rows = await rest('/mailbox_grants?select=stmt_rescan_at&id=eq.' + encodeURIComponent(grantId) + '&limit=1');
        return !!(rows && rows[0] && rows[0].stmt_rescan_at == null);
      } catch { return false; }
    },

    /** The one-time history re-scan is done for this grant. */
    async markStatementRescanned(grantId) {
      await rest('/mailbox_grants?id=eq.' + encodeURIComponent(grantId), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ stmt_rescan_at: new Date().toISOString() }),
      });
    },
  };
}
