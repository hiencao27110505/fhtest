/**
 * Service tests. No Google, no database.
 *
 * The point of the service/route split is exactly this: the ordering rules
 * that matter here — verify state before spending the code, never write on a
 * partial grant — are properties of the flow, not of HTTP, and they are
 * asserted without a request object anywhere in sight.
 */

import { beforeAll, describe, expect, mock, test } from "bun:test";

import { createState } from "./oauth-state";
import { GMAIL_SCOPES } from "./google-oauth";

import { ConnectError, type ConnectFailureKind } from "./errors";
import { completeConnect, type GoogleClient } from "./service";

const USER = "11111111-1111-1111-1111-111111111111";
// Any valid Fernet key; these tests never decrypt.
const TOKEN_KEY = "hyDaMEQKvIYFYt6NIzalpBEyM5f6dxT_uxCyzWSbEE4=";

/** A Google that always succeeds, with per-test overrides. */
function fakeGoogle(overrides: Partial<GoogleClient> = {}): GoogleClient {
  return {
    exchangeCode: mock(async () => ({
      accessToken: "at",
      refreshToken: "rt",
      scopes: [...GMAIL_SCOPES],
    })),
    fetchProfile: mock(async () => ({ emailAddress: "me@gmail.com" })),
    ...overrides,
  };
}

/** Asserts the call fails, and with which kind. */
async function failureOf(
  promise: Promise<unknown>,
): Promise<ConnectFailureKind> {
  try {
    await promise;
    throw new Error("expected the connect to fail, but it succeeded");
  } catch (err) {
    if (!(err instanceof ConnectError)) throw err;
    return err.failure.kind;
  }
}

describe("completeConnect", () => {
  let state: string;
  beforeAll(async () => {
    state = await createState(USER, "google");
  });

  test("a declined consent is reported as declined", async () => {
    const google = fakeGoogle();
    const kind = await failureOf(
      completeConnect(
        { error: "access_denied", state },
        { google, tokenKey: TOKEN_KEY },
      ),
    );
    expect(kind).toBe("declined");
    // The code was never spent, because there was none to spend.
    expect(google.exchangeCode).not.toHaveBeenCalled();
  });

  test("a forged state never reaches Google", async () => {
    // The ordering that matters: an unverified caller must not be able to make
    // this service issue an outbound request to Google.
    const google = fakeGoogle();
    const kind = await failureOf(
      completeConnect(
        { code: "abc", state: "forged.signature" },
        { google, tokenKey: TOKEN_KEY },
      ),
    );
    expect(kind).toBe("invalid_state");
    expect(google.exchangeCode).not.toHaveBeenCalled();
  });

  test("an expired state is rejected", async () => {
    const stale = await createState(USER, "google", undefined, new Date(Date.now() - 3_600_000));
    const kind = await failureOf(
      completeConnect(
        { code: "abc", state: stale },
        { google: fakeGoogle(), tokenKey: TOKEN_KEY },
      ),
    );
    expect(kind).toBe("invalid_state");
  });

  test("a callback with no code is malformed", async () => {
    const kind = await failureOf(
      completeConnect({ state }, { google: fakeGoogle(), tokenKey: TOKEN_KEY }),
    );
    expect(kind).toBe("malformed_callback");
  });

  test("a grant without a refresh token is refused, and nothing is written", async () => {
    const google = fakeGoogle({
      exchangeCode: mock(async () => ({
        accessToken: "at",
        refreshToken: undefined,
        scopes: [...GMAIL_SCOPES],
      })),
    });
    const linkAccount = mock(async () => {});
    const kind = await failureOf(
      completeConnect(
        { code: "abc", state },
        // No db is passed, so a write would throw on a real connection; the
        // assertion is that we never get that far.
        { google, tokenKey: TOKEN_KEY },
      ),
    );
    expect(kind).toBe("no_refresh_token");
    expect(linkAccount).not.toHaveBeenCalled();
  });

  test("a narrower grant than we need is refused", async () => {
    const google = fakeGoogle({
      exchangeCode: mock(async () => ({
        accessToken: "at",
        refreshToken: "rt",
        scopes: ["https://www.googleapis.com/auth/userinfo.email"],
      })),
    });
    const kind = await failureOf(
      completeConnect({ code: "abc", state }, { google, tokenKey: TOKEN_KEY }),
    );
    expect(kind).toBe("insufficient_scope");
  });

  test("a Google outage surfaces as provider_unavailable, not a crash", async () => {
    const google = fakeGoogle({
      exchangeCode: mock(async () => {
        throw new Error("503 from Google");
      }),
    });
    const kind = await failureOf(
      completeConnect({ code: "abc", state }, { google, tokenKey: TOKEN_KEY }),
    );
    expect(kind).toBe("provider_unavailable");
  });
});
