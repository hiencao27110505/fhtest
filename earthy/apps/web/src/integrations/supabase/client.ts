import { createBrowserClient } from "@supabase/ssr";
import { env } from "#/env.ts";

/**
 * Browser-side Supabase client.
 *
 * `createBrowserClient` (rather than plain `createClient`) is what makes the
 * session live in cookies instead of localStorage, which is the only way the
 * server routes and loaders can see it.
 *
 * PKCE is the default flow in @supabase/ssr, and it is what makes the OAuth
 * redirect land on `/api/auth/callback` with a `?code` to exchange.
 */
export const supabase = createBrowserClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
);
