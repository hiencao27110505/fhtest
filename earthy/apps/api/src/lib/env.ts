import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql"),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Origins the browser app is served from, comma-separated. Required and
  // explicit: the API answers requests that carry the user's session cookie,
  // and the CORS spec refuses `Allow-Origin: *` on a credentialed request — a
  // wildcard here does not loosen security, it silently breaks the cookie
  // path entirely.
  WEB_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // Supabase project the caller's JWT comes from. The URL is what the JWKS
  // endpoint is derived from, so a wrong value silently rejects every token.
  SUPABASE_URL: z.url(),

  // The app's OAuth client, shared with serverless/. Per-application, not
  // per-user — the same pair the Python tools use, so a mailbox connected
  // through the web is indistinguishable from one connected by `make connect`.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),

  // Must be registered character-for-character on the OAuth client, or Google
  // answers error 400 redirect_uri_mismatch.
  GOOGLE_OAUTH_REDIRECT_URI: z.url(),

  // Fernet key, base64url of 32 bytes. The SAME key serverless/ decrypts with
  // (GMAIL_TOKEN_KEY there): tokens written here are read by the Python jobs,
  // so the format is not ours to choose.
  GMAIL_TOKEN_KEY: z.string().min(1),

  // Where the browser lands after the callback finishes. Required, not
  // optional: the flow ends inside a browser that was sent to Google by a
  // page, and a JSON body at the end of a redirect chain is not a result a
  // user can act on. Validated at boot so the flow cannot be discovered to be
  // unfinishable at the last step of a real user's consent.
  OAUTH_SUCCESS_REDIRECT: z.url(),
  OAUTH_FAILURE_REDIRECT: z.url(),
});

export type Env = z.infer<typeof schema>;

/**
 * Parses an environment, reporting problems as a readable list.
 *
 * Separate from the exit below so the schema can be exercised without ending
 * the process — a module that kills the runtime on import is a module nothing
 * downstream of it can be tested.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment:\n${detail}`);
}

/**
 * The process environment, validated at import time.
 *
 * Failing here rather than at first use is deliberate: a missing OAuth secret
 * should stop a deployment at boot, not surface as a broken redirect to the
 * first user who tries to connect their mailbox.
 */
function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
