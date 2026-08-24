import { Store, shallow } from "@tanstack/store";
import type { Session, User } from "@supabase/supabase-js";

/**
 * Client-side auth state.
 *
 * One store for the whole app, because there is only ever one Supabase session
 * per browser. Components read slices of it with `useStore`, so a component
 * that only cares about `user` does not re-render when the access token
 * silently refreshes.
 *
 * `status` is deliberately three-valued rather than a boolean: "loading" is a
 * real state, and collapsing it into `user === null` makes every consumer
 * render a signed-out UI for a frame before the session resolves.
 */
export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
}

export const authStore = new Store<AuthState>({
  status: "loading",
  user: null,
  session: null,
});

/** Replace the session after a Supabase auth event. */
export function setAuthSession(session: Session | null) {
  authStore.setState((prev) => {
    const next: AuthState = {
      status: session ? "authenticated" : "anonymous",
      user: session?.user ?? null,
      session,
    };

    // Supabase re-emits on every token refresh. Without this, each refresh
    // pushes a new object identity and re-renders every subscriber for a
    // session that has not meaningfully changed.
    if (
      prev.status === next.status &&
      prev.user?.id === next.user?.id &&
      prev.session?.access_token === next.session?.access_token
    ) {
      return prev;
    }

    return next;
  });
}

/** Selector helpers, so consumers do not each hand-roll the same slices. */
export const selectUser = (state: AuthState) => state.user;
export const selectStatus = (state: AuthState) => state.status;
export const selectIsAuthenticated = (state: AuthState) =>
  state.status === "authenticated";

/**
 * The display fields a header or avatar needs, in one slice.
 *
 * Paired with `shallow` at the call site so a new-but-equal object does not
 * trigger a render.
 */
export const selectProfile = (state: AuthState) => ({
  name:
    (state.user?.user_metadata?.full_name as string | undefined) ??
    (state.user?.user_metadata?.name as string | undefined) ??
    state.user?.email ??
    null,
  email: state.user?.email ?? null,
  avatarUrl:
    (state.user?.user_metadata?.avatar_url as string | undefined) ?? null,
});

export { shallow };
