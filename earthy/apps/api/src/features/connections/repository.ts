import { connectedAccounts, db as defaultDb } from "@earthy/db";
import { and, eq, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ConnectError } from "./errors";

/**
 * The only module that writes `connected_accounts`.
 *
 * It exists because that table carries TWO unique constraints (migration
 * 0070), and getting a link right means satisfying both:
 *
 *   (provider, provider_account_id) — one row per mailbox, globally
 *   (user_id, provider)            — one link per provider, per user
 *
 * A plain `on conflict (provider, provider_account_id) do update` handles only
 * the first, and fails both remaining cases in a way nobody would notice from
 * the route: connecting a mailbox that belongs to someone else UPDATES their
 * row while leaving `user_id` pointing at them, and connecting a second
 * mailbox for the same user raises a duplicate-key 500. Both are reproduced in
 * `repository.test.ts` against the real DDL.
 *
 * So the write is expressed as what it actually is — "this user has exactly
 * one Google link; make it be this mailbox" — and runs in a transaction.
 */

/**
 * The database handle this module needs.
 *
 * Deliberately NOT `typeof db`: that type is parameterised by the full schema,
 * so it would force every caller — a test included — to construct a handle
 * that knows about every unrelated table. Widening it to the base
 * `NodePgDatabase` says what is actually required, which is a connection that
 * can run these statements.
 *
 * The schema parameter is `any` because it is genuinely unconstrained here —
 * these queries name their columns explicitly and never go through the
 * relational query builder, so no part of this module depends on it.
 */
// biome-ignore lint/suspicious/noExplicitAny: schema is irrelevant to these queries
export type Database = NodePgDatabase<any>;

/** A mailbox link, as the caller describes it. */
export type AccountLink = {
  userId: string;
  provider: string;
  /** Stable id at the provider. For Google this is the mailbox address. */
  providerAccountId: string;
  email: string;
  /** Ciphertext. This layer never sees, and never logs, a plaintext token. */
  refreshTokenEnc: Uint8Array;
  scopes: string[];
};

/** What a link looks like when shown back to its owner. Never the ciphertext. */
export type PublicAccountLink = {
  id: number;
  provider: string;
  email: string | null;
  scopes: string;
  needsReauth: boolean;
  connectedAt: Date;
};

/**
 * Makes `link` the caller's single link for that provider.
 *
 * Rules, in the order they are enforced:
 *
 *   1. If the mailbox is already linked to a DIFFERENT user, refuse. It is not
 *      ours to move: the other account may be receiving that mailbox's data
 *      today, and consent for a mailbox is not consent to take it from them.
 *   2. Otherwise drop whatever other link this user had for the provider —
 *      "connect a different mailbox" is a replacement, not a second row, and
 *      the (user_id, provider) index says so.
 *   3. Then upsert the mailbox row itself, refreshing the token and clearing
 *      `needs_reauth`, which is what a user reconnecting after an expiry needs.
 *
 * Wrapped in a transaction so step 2 cannot land without step 3: a crash in
 * between would otherwise leave the user with no link at all.
 */
export async function linkAccount(
  link: AccountLink,
  db: Database = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: connectedAccounts.userId })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.provider, link.provider),
          eq(connectedAccounts.providerAccountId, link.providerAccountId),
        ),
      )
      // Blocks a concurrent second callback for the same mailbox from reading
      // "unclaimed" at the same moment and both proceeding.
      .for("update");

    if (existing && existing.userId !== link.userId) {
      throw new ConnectError({ kind: "mailbox_taken" });
    }

    await tx
      .delete(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.userId, link.userId),
          eq(connectedAccounts.provider, link.provider),
          ne(connectedAccounts.providerAccountId, link.providerAccountId),
        ),
      );

    const scopes = link.scopes.join(" ");
    await tx
      .insert(connectedAccounts)
      .values({
        userId: link.userId,
        provider: link.provider,
        providerAccountId: link.providerAccountId,
        email: link.email,
        refreshTokenEnc: link.refreshTokenEnc,
        scopes,
      })
      .onConflictDoUpdate({
        target: [
          connectedAccounts.provider,
          connectedAccounts.providerAccountId,
        ],
        set: {
          refreshTokenEnc: link.refreshTokenEnc,
          scopes,
          needsReauth: false,
          updatedAt: new Date(),
        },
      });
  });
}

/**
 * The caller's links.
 *
 * The column list is explicit and deliberately omits `refresh_token_enc`:
 * `select()` with no argument would put ciphertext one `c.json(rows)` away
 * from a browser.
 */
export async function listAccounts(
  userId: string,
  db: Database = defaultDb,
): Promise<PublicAccountLink[]> {
  return db
    .select({
      id: connectedAccounts.id,
      provider: connectedAccounts.provider,
      email: connectedAccounts.email,
      scopes: connectedAccounts.scopes,
      needsReauth: connectedAccounts.needsReauth,
      connectedAt: connectedAccounts.connectedAt,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId));
}

/**
 * Removes the caller's link for one provider. Returns how many rows went.
 *
 * Scoped to `userId` as well as provider — a filter on provider alone would
 * let any authenticated caller disconnect somebody else's mailbox.
 */
export async function unlinkAccount(
  userId: string,
  provider: string,
  db: Database = defaultDb,
): Promise<number> {
  const removed = await db
    .delete(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.provider, provider),
      ),
    )
    .returning({ id: connectedAccounts.id });
  return removed.length;
}
