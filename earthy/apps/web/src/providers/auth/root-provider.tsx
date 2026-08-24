import { createContext, useContext, useEffect, useMemo } from "react";
import { useSelector } from "@tanstack/react-store";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "#/integrations/supabase/client.ts";
import {
  authStore,
  selectProfile,
  setAuthSession,
  shallow,
  type AuthState,
} from "./auth-store.ts";

/**
 * Owns the one `onAuthStateChange` subscription for the whole app.
 *
 * The subscription lives here rather than in each component because Supabase
 * fires on every token refresh across every listener — N components meant N
 * duplicate subscriptions doing the same work. The provider writes to the
 * store; components read slices from it.
 *
 * The context itself carries only the actions. State comes from the store, so
 * a token refresh does not re-render every consumer of the context value the
 * way a context-held session object would.
 */
interface AuthActions {
  signInWithGoogle: (next?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthActions | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    // `getSession` reads the existing cookie so a reload does not flash the
    // signed-out UI. It is not a trust boundary — anything that gates access
    // re-verifies on the server via `fetchUser`.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setAuthSession(data.session ?? null);
      })
      .catch((cause) => {
        // Resolve to signed-out rather than leaving `status` at "loading"
        // forever: a stuck skeleton is worse than a sign-in button, and the
        // server guards re-verify anyway.
        console.error("[auth] getSession failed", cause);
        if (active) setAuthSession(null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthSession(session);
      // Re-run loaders and `beforeLoad` guards so server-rendered auth state
      // cannot go stale behind a client-side navigation. Skip the refresh
      // events, which fire often and change nothing a guard would see.
      if (event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") {
        void router.invalidate();
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  const actions = useMemo<AuthActions>(
    () => ({
      async signInWithGoogle(next = "/") {
        const callback = new URL("/api/auth/callback", window.location.origin);
        callback.searchParams.set("next", next);

        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: callback.toString(),
            // scopes: "https://www.googleapis.com/auth/gmail.readonly",
            // queryParams: {
            //   access_type: "offline",
            //   prompt: "consent",
            // },
          },
        });

        // On success the browser is already navigating away, so this only
        // returns when the redirect never got off the ground.
        return { error: error?.message ?? null };
      },

      async signOut() {
        await supabase.auth.signOut();
        // Land somewhere public: staying on a protected page would just
        // bounce through the `_authed` guard.
        await router.navigate({ to: "/" });
      },
    }),
    [router],
  );

  return <AuthContext value={actions}>{children}</AuthContext>;
}

/** The sign-in / sign-out actions. */
export function useAuthActions(): AuthActions {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  throw new Error("useAuthActions must be used within <AuthProvider>");
}

/** Read any slice of auth state. */
export function useAuth<T>(
  selector: (state: AuthState) => T,
  compare?: (a: T, b: T) => boolean,
): T {
  return useSelector(authStore, selector, { compare });
}

/** The common slices, so consumers do not re-derive them. */
export const useAuthUser = () => useSelector(authStore, (s) => s.user);
export const useAuthStatus = () => useSelector(authStore, (s) => s.status);
export const useIsAuthenticated = () => {
  return useSelector(authStore, (s) => s.status === "authenticated");
};
// `shallow` matters here: the selector builds a fresh object each call, so
// without it every store notification would re-render the consumer.
export const useAuthProfile = () => {
  return useSelector(authStore, selectProfile, { compare: shallow });
};
