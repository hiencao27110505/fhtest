/**
 * Every way connecting a mailbox can fail, as one closed set.
 *
 * Modelled as a union rather than thrown strings so the compiler enforces that
 * the callback handles each case: adding a member here fails the build at the
 * place that turns a failure into a response, instead of silently falling
 * through to a generic error the user cannot act on.
 *
 * The `kind` values are also the `reason` the browser is redirected back with,
 * so they are part of the contract with the frontend — treat a rename as a
 * breaking change to that page.
 */
export type ConnectFailure =
  /** The user pressed "cancel" on Google's consent screen. Not an error. */
  | { kind: "declined"; providerError: string }
  /** Callback reached without the parameters Google is supposed to send. */
  | { kind: "malformed_callback" }
  /** State missing, forged, or older than its TTL. Possibly an attack. */
  | { kind: "invalid_state" }
  /** Google refused the code exchange, or the profile lookup failed. */
  | { kind: "provider_unavailable"; cause: unknown }
  /**
   * Google returned no refresh token — it issues one only on a first grant.
   * The user has to revoke the app before retrying, so this needs its own
   * message rather than a generic failure.
   */
  | { kind: "no_refresh_token" }
  /** The grant came back narrower than the pipeline needs. */
  | { kind: "insufficient_scope"; granted: string[] }
  /**
   * This mailbox is already connected to a different app user. Refused rather
   * than reassigned: silently moving it would let anyone who can pass consent
   * for a mailbox take it off the account currently receiving its data.
   */
  | { kind: "mailbox_taken" };

export type ConnectFailureKind = ConnectFailure["kind"];

/**
 * Thrown by the service layer, caught at the route boundary.
 *
 * Carries the union rather than a message: the service has no opinion about
 * HTTP, and the boundary decides how each case is worded and redirected.
 */
export class ConnectError extends Error {
  /**
   * Where to send the user back to, when the flow got far enough to know.
   *
   * Failures before the state is read (a forged token, a declined consent)
   * have no way of knowing where the user started, so this is undefined and
   * the route falls back to the configured page. Failures after it — a
   * mailbox already taken, Google unreachable — can still return them to what
   * they were doing, which is where the error message makes sense.
   */
  constructor(
    readonly failure: ConnectFailure,
    readonly returnTo?: string,
  ) {
    super(failure.kind);
    this.name = "ConnectError";
  }
}
