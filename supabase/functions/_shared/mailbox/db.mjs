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
export const MAX_GRANTS_PER_RUN = 25;

/* The subject_template of a SENDER-WIDE verdict, as opposed to a per-shape one.
   A literal no real subject can normalise to — a normalised shape is derived
   from actual subject text, and this is punctuation only. */
export const SENDER_SENTINEL = '*';

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
        select: 'id,user_id,member_id,family_id,provider,email,refresh_token_enc,scopes,needs_reauth,history_id,last_synced_at,backfilled_at,default_scope,backfill_days',
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
     * The grant for one mailbox address, for a push notification to resolve.
     *
     * Two lookups, not one: the exact address first, then the Gmail-folded
     * form. Google returns the canonical address in both the profile call and
     * the push, so the first should always hit — but a miss here is a
     * notification silently dropped for a mailbox we do hold, which is
     * indistinguishable from a quiet mailbox. The forwarding pipeline was
     * bitten by exactly this. The fallback costs one query on a path that
     * already failed.
     */
    async grantByEmail(email, folded) {
      const q = e => new URLSearchParams({
        select: 'id,user_id,member_id,family_id,provider,email,refresh_token_enc,scopes,needs_reauth,history_id,last_synced_at,backfilled_at,watch_expires_at,default_scope,backfill_days',
        email: 'eq.' + e,
        needs_reauth: 'eq.false',
        limit: '1',
      });
      let rows = await rest('/mailbox_grants?' + q(email).toString());
      if ((!rows || !rows.length) && folded && folded !== email) {
        rows = await rest('/mailbox_grants?' + q(folded).toString());
      }
      return (rows && rows[0]) || null;
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
      const qs = new URLSearchParams({
        select: 'sender_address,subject_template,is_transaction_source,transaction_type,extraction_regex,last_verified_at',
        sender_address: 'eq.' + sender,
        subject_template: 'in.(' + [template, SENDER_SENTINEL].map(v => '"' + encodeURIComponent(v) + '"').join(',') + ')',
      });
      const rows = (await rest('/sender_fingerprints?' + qs.toString())) || [];
      const exact = rows.find(r => r.subject_template === template) || null;
      const sentinel = rows.find(r => r.subject_template === SENDER_SENTINEL) || null;
      // The exact shape always wins: a sender can be mostly noise and still have
      // one template worth reading, and that row is the more specific answer.
      if (exact) return exact;
      return sentinel ? { ...sentinel, _sender_wide: true } : null;
    },

    /* How much this sender has cost, and whether it has ever paid off.
       Only asked after a model call has already decided "not a transaction", so
       it is one query per NEW junk shape rather than per message. */
    async senderTally(sender) {
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
      await rest('/sender_fingerprints?on_conflict=sender_address,subject_template', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
    },

    /** Bank domains, if anyone has seeded them. Empty is the normal case. */
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
    async alreadyStaged(messageIds, memberId, ownerUserId) {
      if (!messageIds.length) return new Set();
      // Each id is encoded on its own and the commas stay literal. Encoding the
      // joined string instead turns the SEPARATORS into %2C, which happens to
      // survive PostgREST's decode today but makes the query's meaning depend on
      // decode order rather than on what was written.
      const list = messageIds.map(id => '"' + encodeURIComponent(id) + '"').join(',');
      const staged = await rest(
        '/email_transactions?select=gmail_message_id&gmail_message_id=in.(' + list + ')');
      const done = new Set((staged || []).map(r => r.gmail_message_id));

      // Scoped to the member: one person finishing with a message says nothing
      // about another who connected the same shared mailbox. Without a member
      // the resolved half is skipped rather than asked unscoped — a global
      // answer here would hide one person's mail behind another's decision.
      /* Scoped by owner where there is one, member otherwise. Since 0092 the
         tombstone table is KEYED on owner — a personal-only user has no member
         to key on, and a tombstone that cannot be written is a message that
         comes back on every wide read forever. Asking unscoped would be worse
         than not asking: one person's decision would hide another's mail. */
      const scope = ownerUserId
        ? 'owner_user_id=eq.' + encodeURIComponent(ownerUserId)
        : (memberId ? 'member_id=eq.' + encodeURIComponent(memberId) : null);
      if (scope) {
        const resolved = await rest(
          '/resolved_email_messages?select=gmail_message_id&' + scope +
          '&gmail_message_id=in.(' + list + ')');
        for (const r of (resolved || [])) done.add(r.gmail_message_id);
      }
      return done;
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
     * Inserts one staged row.
     *
     * A unique violation on `gmail_message_id` returns false rather than
     * throwing: it means another run staged this message between our check and
     * our insert, which is the guard working, not a failure.
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
  };
}
