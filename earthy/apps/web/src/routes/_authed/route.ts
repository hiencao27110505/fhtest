import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchUser } from "#/integrations/supabase/auth.ts";

/**
 * Layout route that gates everything nested under it.
 *
 * Any route file named `_authed.<name>.tsx` sits behind this check. The guard
 * runs in `beforeLoad`, so an unauthenticated visitor never renders the
 * protected component at all — and the path they wanted rides along as `next`
 * so the callback can return them there after sign-in.
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const user = await fetchUser();
    if (user) {
      // Handed down to every nested route via context, so a protected page can
      // read the user without a second round trip.
      return { user };
    }

    throw redirect({
      to: "/sign-in",
      search: { next: location.href },
    });
  },
  // No `component` on purpose: a pathless layout route that renders one would
  // also claim "/" and collide with routes/index.tsx. Children render through
  // the default outlet, so the guard is all this route needs to contribute.
});
