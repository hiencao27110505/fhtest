/**
 * Who a mailbox's transactions belong to, and which key seals them.
 *
 * This is the direct-read answer to the question the forwarding transport
 * solves with a `+tag`: given a message, which member owns it and which
 * family's staging key locks it. Under OAuth the answer comes from the grant
 * itself — we fetch from a mailbox we hold a grant for, so ownership is proven
 * rather than inferred from a header a sender controls. That is the whole
 * structural upside of this transport (OAUTH-DIRECT-READ §2), and it is why
 * there is no routing table, no alias lookup and no unroutable-mail limbo here.
 *
 * WHAT IS STILL LEFT TO CHECK, AND WHY.
 *
 * grant_mailbox_access() (migration 0087) already refused to store a grant
 * whose user had no member row in a real family, so the destination was valid
 * the moment it was written. It can stop being valid afterwards: a member is
 * archived, a family is archived, the member is moved, the family never minted
 * a staging keypair. None of those are errors — they are states, and every one
 * of them is a HOLD.
 *
 * HOLD, NEVER STAGE-ANYWAY. Each of these has a specific failure it prevents:
 *
 *   - no member / archived member  → email_transactions has no family_id
 *     column, so member_id is a row's ONLY link to a family (0058). A row with
 *     a dead member is visible to nobody, forever. Staging it accumulates data
 *     that can never be surfaced or deleted by the person it describes.
 *   - member moved to another family → the grant's family_id is what the row
 *     would be sealed to. Sealing to a family the member has left produces a
 *     row their current family cannot open and their old family cannot see.
 *   - no staging_pub → there is nothing to seal to, and there is no code path
 *     from "could not seal" to a plaintext insert. SEALED-STAGING-DESIGN §4.3.
 *
 * A hold is cheap and self-healing: the cursor is not advanced, so the same
 * window is read again on the next poll, and the moment the family unlocks a
 * device and mints a staging key the mail stages correctly with nothing to
 * re-fetch. That is the same bargain the forwarding transport makes when it
 * leaves a message queued in txn/inbox.
 */

/** Why a mailbox could not be resolved. Greppable in logs, asserted in tests. */
export const HOLD = {
  NEEDS_REAUTH: 'needs_reauth',
  NO_MEMBER: 'no_member',
  MEMBER_ARCHIVED: 'member_archived',
  MEMBER_MOVED: 'member_moved',
  NO_STAGING_PUB: 'no_staging_pub',
  /* Declared default_scope='personal', but the person has never provisioned a
     personal staging keypair. Distinct from NO_STAGING_PUB on purpose: the two
     clear differently — a family key is minted by ANY family device unlocking,
     this one only by THIS person unlocking their own. Reporting them as one
     reason would send someone to ask a relative to unlock, which cannot help. */
  NO_PERSONAL_STAGING_PUB: 'no_personal_staging_pub',
};

/**
 * A destination that is not usable right now.
 *
 * An Error rather than a null return, so a caller cannot reach the staging code
 * by forgetting to check. `reason` is one of HOLD.
 */
export class MailboxHold extends Error {
  constructor(reason, detail) {
    super('mailbox_hold:' + reason + (detail ? ' (' + detail + ')' : ''));
    this.name = 'MailboxHold';
    this.reason = reason;
  }
}

/**
 * The store this module needs. Structural, so the worker passes a Supabase
 * client wrapper and a test passes an object literal.
 *
 *   memberById(id)             -> {id, family_id, archived_at} | null
 *   stagingPubForFamily(fid)   -> base64 string | null
 *   stagingPubForUser(uid)     -> base64 string | null
 */

/**
 * Resolves one grant to the destination a staged row needs.
 *
 * WHICH KEY, AND WHY IT IS DECIDED HERE.
 *
 * Since Model Y (0079) a person's money has two destinations: the family ledger
 * under a shared key, and `personal_transactions` under their own. A grant
 * declares which one its mailbox feeds (`default_scope`, 0091), and that choice
 * has to be made BEFORE anything is read — a row cannot be re-sealed later, so
 * deciding at review would mean the plaintext had already touched a key the
 * person did not choose. The review screen still picks the destination LEDGER
 * per row; this picks the key that protects the row on the way there.
 *
 * `memberId` is returned for both scopes. It is the same person's own member row
 * either way, so 0058's RLS keeps working unchanged, and dedup keeps seeing one
 * mailbox rather than two — a bank email must not stage twice merely because a
 * second copy was destined for a different ledger.
 *
 * @param {{member_id: string, family_id: string, user_id?: string, default_scope?: string, needs_reauth?: boolean, email?: string}} grant
 * @param {{memberById: Function, stagingPubForFamily: Function, stagingPubForUser?: Function}} db
 * @return {Promise<{memberId: string, familyId: string, stagingPub: string, scope: string}>}
 * @throws {MailboxHold}
 */
export async function resolveDestination(grant, db) {
  if (!grant || !grant.member_id || !grant.family_id) {
    throw new MailboxHold(HOLD.NO_MEMBER, 'grant carries no destination');
  }
  // Checked here as well as in the poller's query. The poller filters on it to
  // avoid spending a token refresh; this is the invariant, and an invariant
  // that only one caller enforces is one refactor away from being gone.
  if (grant.needs_reauth) throw new MailboxHold(HOLD.NEEDS_REAUTH);

  const member = await db.memberById(grant.member_id);
  if (!member) throw new MailboxHold(HOLD.NO_MEMBER, grant.member_id);
  if (member.archived_at) throw new MailboxHold(HOLD.MEMBER_ARCHIVED, grant.member_id);

  // The grant's family_id is what the sealer will use and what the opener will
  // verify. If the member no longer belongs to it, sealing to it produces a row
  // nobody can open — so the disagreement itself is the thing to stop on,
  // rather than quietly preferring one side of it.
  if (member.family_id !== grant.family_id) {
    throw new MailboxHold(HOLD.MEMBER_MOVED,
      grant.family_id + ' -> ' + member.family_id);
  }

  // Unrecognised values fall back to 'family' rather than throwing: the column
  // is CHECK-constrained, so anything else means a client wrote a scope this
  // build predates, and the safe reading of an unknown scope is the one every
  // grant had before the column existed.
  const scope = grant.default_scope === 'personal' ? 'personal' : 'family';

  if (scope === 'personal') {
    if (!grant.user_id) throw new MailboxHold(HOLD.NO_PERSONAL_STAGING_PUB, 'grant carries no user');
    const personalPub = db.stagingPubForUser ? await db.stagingPubForUser(grant.user_id) : null;
    if (!personalPub) throw new MailboxHold(HOLD.NO_PERSONAL_STAGING_PUB, grant.user_id);
    return {
      memberId: grant.member_id,
      familyId: grant.family_id,
      stagingPub: personalPub,
      scope,
    };
  }

  const stagingPub = await db.stagingPubForFamily(grant.family_id);
  if (!stagingPub) throw new MailboxHold(HOLD.NO_STAGING_PUB, grant.family_id);

  return {
    memberId: grant.member_id,
    familyId: grant.family_id,
    stagingPub,
    scope,
  };
}

/**
 * Whether a hold should stop the whole mailbox or just this message.
 *
 * Every hold this module raises is a property of the MAILBOX, not of a message
 * — a missing staging key does not become present between two messages of the
 * same poll. So they all stop the mailbox, and the poller moves to the next
 * grant instead of fetching mail it cannot stage. Kept as a function rather
 * than assumed, because per-message holds are exactly what the parse side will
 * add later, and the caller should be reading a decision rather than a comment.
 */
export function stopsMailbox(hold) {
  return hold instanceof MailboxHold;
}
