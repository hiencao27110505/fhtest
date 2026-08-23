/**
 * Repository tests against a real Postgres holding the real 0070 DDL.
 *
 * Real, not mocked, on purpose: everything this module gets wrong, it gets
 * wrong at the constraint level. A mocked `db` would happily accept the exact
 * upsert that raises duplicate-key against the actual table, so a test with no
 * database would have passed on the bugs the first two cases here pin down.
 *
 * Point TEST_DATABASE_URL at a throwaway database; the suite skips without it
 * rather than inventing a connection.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { connectedAccounts } from "@earthy/db/schema";

import { ConnectError } from "./errors";
import { linkAccount, listAccounts, unlinkAccount } from "./repository";

const url = process.env.TEST_DATABASE_URL;

describe.if(Boolean(url))("connected account repository", () => {
  const db = drizzle(url!, { schema: { connectedAccounts } });

  const ALICE = "11111111-1111-1111-1111-111111111111";
  const BOB = "22222222-2222-2222-2222-222222222222";
  const token = (s: string) => new TextEncoder().encode(s);

  const link = (userId: string, mailbox: string, secret = "ct") => ({
    userId,
    provider: "google",
    providerAccountId: mailbox,
    email: mailbox,
    refreshTokenEnc: token(secret),
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  beforeEach(async () => {
    // `delete`, not `truncate`: gmail_sync_state carries a foreign key onto
    // this table, and truncating the target of one is refused outright.
    await db.execute(sql`delete from public.connected_accounts`);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  test("connecting a second mailbox replaces the first", async () => {
    // Regression: the (user_id, provider) unique index made this a
    // duplicate-key 500 when the write targeted only the mailbox constraint.
    await linkAccount(link(ALICE, "first@gmail.com"), db);
    await linkAccount(link(ALICE, "second@gmail.com"), db);

    const rows = await listAccounts(ALICE, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("second@gmail.com");
  });

  test("a mailbox owned by another user is refused, not reassigned", async () => {
    // Regression: `do update` left user_id pointing at the first owner, so the
    // second user's token was stored under the first user's account and the
    // request still reported success.
    await linkAccount(link(ALICE, "shared@gmail.com", "alice-token"), db);

    const attempt = linkAccount(link(BOB, "shared@gmail.com", "bob-token"), db);
    await expect(attempt).rejects.toBeInstanceOf(ConnectError);

    expect(await listAccounts(BOB, db)).toHaveLength(0);
    const [row] = await listAccounts(ALICE, db);
    expect(row?.email).toBe("shared@gmail.com");
  });

  test("reconnecting the same mailbox refreshes the token and clears reauth", async () => {
    await linkAccount(link(ALICE, "me@gmail.com", "old"), db);
    await db
      .update(connectedAccounts)
      .set({ needsReauth: true })
      .execute();

    await linkAccount(link(ALICE, "me@gmail.com", "new"), db);

    const [row] = await listAccounts(ALICE, db);
    expect(row?.needsReauth).toBe(false);

    const [stored] = await db
      .select({ enc: connectedAccounts.refreshTokenEnc })
      .from(connectedAccounts);
    expect(new TextDecoder().decode(stored!.enc)).toBe("new");
  });

  test("listing never exposes the ciphertext", async () => {
    await linkAccount(link(ALICE, "me@gmail.com"), db);
    const [row] = await listAccounts(ALICE, db);
    expect(row).not.toHaveProperty("refreshTokenEnc");
  });

  test("unlink removes only the caller's own row", async () => {
    await linkAccount(link(ALICE, "alice@gmail.com"), db);
    await linkAccount(link(BOB, "bob@gmail.com"), db);

    expect(await unlinkAccount(BOB, "google", db)).toBe(1);
    expect(await listAccounts(ALICE, db)).toHaveLength(1);
  });

  test("unlink reports nothing removed when there is no link", async () => {
    expect(await unlinkAccount(ALICE, "google", db)).toBe(0);
  });
});
