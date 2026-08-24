/**
 * Test environment, loaded via `bunfig.toml`'s preload.
 *
 * `src/lib/env.ts` validates at import time and exits the process when the
 * environment is incomplete — correct for a server, fatal for a test runner.
 * Rather than weaken that check, the suite supplies values that satisfy it.
 *
 * These are placeholders and must stay placeholders: a real secret in a
 * committed file is a leaked secret. Tests that need a database read
 * TEST_DATABASE_URL and skip without it.
 */

const placeholders: Record<string, string> = {
  DATABASE_URL: "postgresql://test@localhost:5432/test",
  // The ref in this hostname is what AUTH_COOKIE_NAME is derived from, and
  // auth.test.ts asserts the resulting `sb-test-auth-token`.
  SUPABASE_URL: "https://test.supabase.co",
  GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/connections/google/callback",
  // A syntactically valid Fernet key. Not used to protect anything.
  GMAIL_TOKEN_KEY: "hyDaMEQKvIYFYt6NIzalpBEyM5f6dxT_uxCyzWSbEE4=",
  OAUTH_SUCCESS_REDIRECT: "http://localhost:3000/settings?connected=google",
  OAUTH_FAILURE_REDIRECT: "http://localhost:3000/settings?connect_failed=google",
  WEB_ORIGINS: "http://localhost:3000",
  NODE_ENV: "test",
};

for (const [key, value] of Object.entries(placeholders)) {
  // Never override: a test run that deliberately sets one of these wins.
  process.env[key] ??= value;
}
