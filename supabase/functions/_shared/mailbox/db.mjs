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
        select: 'id,user_id,member_id,family_id,provider,email,refresh_token_enc,scopes,needs_reauth,history_id,last_synced_at,backfilled_at',
        needs_reauth: 'eq.false',
        order: 'last_synced_at.nullsfirst',
        limit: String(limit || MAX_GRANTS_PER_RUN),
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

    async stagingPubForFamily(familyId) {
      const rows = await rest('/family_keys?select=staging_pub&family_id=eq.' + familyId);
      return (rows && rows[0] && rows[0].staging_pub) || null;
    },

    /** The shared classification cache, keyed on sender AND subject template. */
    async fingerprint(sender, template) {
      const qs = new URLSearchParams({
        select: 'sender_address,subject_template,is_transaction_source,transaction_type,extraction_regex',
        sender_address: 'eq.' + sender,
        subject_template: 'eq.' + template,
      });
      const rows = await rest('/sender_fingerprints?' + qs.toString());
      return (rows && rows[0]) || null;
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
    async alreadyStaged(messageIds) {
      if (!messageIds.length) return new Set();
      const list = messageIds.map(id => '"' + id + '"').join(',');
      const rows = await rest(
        '/email_transactions?select=gmail_message_id&gmail_message_id=in.(' + encodeURIComponent(list) + ')');
      return new Set((rows || []).map(r => r.gmail_message_id));
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
