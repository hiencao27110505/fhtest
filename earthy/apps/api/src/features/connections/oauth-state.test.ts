/**
 * State token tests.
 *
 * This token is the only thing identifying the user at the callback, so the
 * cases that matter are the adversarial ones: a forged signature, a token
 * whose payload was edited to name a different user, and one that has expired.
 */

import { describe, expect, test } from "bun:test";

import { createState, readState } from "./oauth-state";

const USER = "11111111-1111-1111-1111-111111111111";

describe("oauth state", () => {
  test("round trips the user id", async () => {
    expect(await readState(await createState(USER, "google"))).toMatchObject({
      userId: USER,
      provider: "google",
    });
  });

  test("two states for the same user differ", async () => {
    // Without the nonce, two flows started in the same second are the same
    // string, and one browser's callback is replayable in another's.
    expect(await createState(USER, "google")).not.toBe(await createState(USER, "google"));
  });

  test("rejects a tampered payload", async () => {
    // The attack this defends against: re-point a valid-looking state at
    // someone else's user id and hand the callback a mailbox they own.
    const forged = Buffer.from(
      JSON.stringify({
        sub: "22222222-2222-2222-2222-222222222222",
        prv: "google",
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: "x",
      }),
    ).toString("base64url");
    const [, signature] = (await createState(USER, "google")).split(".");
    expect(await readState(`${forged}.${signature}`)).toBeNull();
  });

  test("rejects a forged signature", async () => {
    const [body] = (await createState(USER, "google")).split(".");
    expect(await readState(`${body}.AAAAAAAA`)).toBeNull();
  });

  test("rejects an expired token", async () => {
    const stale = await createState(USER, "google", undefined, new Date(Date.now() - 3_600_000));
    expect(await readState(stale)).toBeNull();
  });

  test("accepts one that is still inside its window", async () => {
    const recent = await createState(USER, "google", undefined, new Date(Date.now() - 60_000));
    expect(await readState(recent)).toMatchObject({ userId: USER });
  });

  test("carries returnTo through, inside the signature", async () => {
    // It rides in the signed payload rather than on the callback URL, so
    // Google echoing the URL back cannot turn it into an open redirect.
    const state = await createState(USER, "google", "/settings/email");
    expect(await readState(state)).toMatchObject({
      userId: USER,
      returnTo: "/settings/email",
    });
  });

  test("a state with no returnTo reports none", async () => {
    expect(await readState(await createState(USER, "google"))).toMatchObject({
      returnTo: undefined,
    });
  });

  test("a tampered returnTo invalidates the whole token", async () => {
    const state = await createState(USER, "google", "/settings");
    const [, signature] = state.split(".");
    const swapped = Buffer.from(
      JSON.stringify({
        sub: USER,
        prv: "google",
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce: "x",
        returnTo: "https://evil.example",
      }),
    ).toString("base64url");
    expect(await readState(`${swapped}.${signature}`)).toBeNull();
  });

  test("rejects malformed input rather than throwing", async () => {
    // The value arrives on a URL, so it can be anything at all.
    for (const bad of ["", ".", "no-dot", "a.b.c", "!!!.???"]) {
      expect(await readState(bad)).toBeNull();
    }
  });
});
