import { z } from "zod";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Query-param schemas and redirect helpers shared by the auth callback and
 * verify routes.
 *
 * Both routes end the same way: work out where the user should land, then send
 * a 303 there. Keeping that in one place means the open-redirect guard below
 * can't drift between the two.
 */

/**
 * Resolve the post-auth destination from a caller-supplied `next` param.
 *
 * `next` arrives from the query string, so it is attacker-controlled: without
 * this check, `?next=https://evil.com` would turn our own auth route into an
 * open redirect that looks like it came from us. Only same-origin *paths* are
 * allowed through.
 *
 * The `//` case matters as much as the absolute-URL case — browsers read
 * `//evil.com` as a protocol-relative URL and will happily leave the origin.
 */
export function resolveRedirectPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  return next;
}

/**
 * A `next` param that is always safe to redirect to.
 *
 * Modelled as a transform rather than a refinement on purpose: a hostile or
 * malformed `next` should quietly fall back to "/" and still let the user
 * finish signing in, not fail the whole request and strand them.
 */
const nextParam = z
  .string()
  .nullish()
  .transform((value) => resolveRedirectPath(value));

/**
 * The OTP types Supabase can send to the verify route. Anything outside this
 * set is a malformed or tampered link.
 */
export const EMAIL_OTP_TYPES = [
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
] as const satisfies readonly EmailOtpType[];

/**
 * `/api/auth/callback` — the OAuth (PKCE) redirect target.
 *
 * A callback arrives in exactly one of two shapes, so the schema is a union
 * rather than one object of optional fields:
 *
 * - success: `code` is present, and required — there is no such thing as a
 *   successful callback without one.
 * - failure: the provider dropped the code entirely and sent `error` /
 *   `error_description` instead (denied consent, and so on).
 *
 * Modelling it this way means a success callback missing its `code` is a hard
 * parse failure, while a genuine provider error still parses and keeps its
 * message for the user.
 */
const callbackSuccessSchema = z.object({
  code: z.string().nonempty(),
  next: nextParam,
});

const callbackFailureSchema = z.object({
  error: z.string().nonempty(),
  error_description: z.string().optional(),
  next: nextParam,
});

export const callbackQuerySchema = z.union([
  callbackFailureSchema,
  callbackSuccessSchema,
]);

/**
 * `/api/auth/verify` — the email-link target.
 *
 * Both fields are required here: unlike the callback there is no partial-
 * failure shape to preserve, so a link missing either half is simply invalid.
 */
export const verifyQuerySchema = z.object({
  token_hash: z.string().nonempty(),
  type: z.enum(EMAIL_OTP_TYPES),
  next: nextParam,
});

export type CallbackQuery = z.infer<typeof callbackQuerySchema>;
export type VerifyQuery = z.infer<typeof verifyQuerySchema>;

/**
 * Parse a URL's query string against a schema.
 *
 * Deliberately non-throwing: these routes run in the middle of a login, so a
 * bad param has to become a friendly redirect, never an unhandled 500.
 */
export function parseQuery<T extends z.ZodType>(
  schema: T,
  url: URL,
): z.ZodSafeParseResult<z.infer<T>> {
  return schema.safeParse(Object.fromEntries(url.searchParams));
}

/** Build a 303 response pointing at a path on this origin. */
export function redirectTo(base: URL, path: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(path, base.origin).toString() },
  });
}

/** Send the user back to the sign-in screen with a surfaced error message. */
export function redirectToError(base: URL, message: string): Response {
  return redirectTo(base, `/sign-in?error=${encodeURIComponent(message)}`);
}
