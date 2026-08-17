import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "#/integrations/supabase/server.ts";

/**
 * Read the signed-in user from the request's auth cookies.
 *
 * Uses `getUser()` rather than `getSession()` on purpose: `getSession()` only
 * decodes whatever the cookie claims, while `getUser()` verifies the token
 * against Supabase. Anything that gates access has to use the verified form —
 * the cookie is client-controlled.
 *
 * Returns a plain object rather than the Supabase `User` so the payload stays
 * small and serializable across the server boundary.
 */
export const fetchUser = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    name:
      (data.user.user_metadata?.full_name as string | undefined) ??
      (data.user.user_metadata?.name as string | undefined) ??
      null,
    avatarUrl:
      (data.user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
});

export type AuthUser = Awaited<ReturnType<typeof fetchUser>>;

/** Clear the session cookies server-side. */
export const signOutFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const supabase = createServerClient();
    await supabase.auth.signOut();
    return { ok: true };
  },
);
