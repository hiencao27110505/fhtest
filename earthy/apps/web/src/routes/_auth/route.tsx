import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { fetchUser } from "#/integrations/supabase/auth.ts";
import { resolveRedirectPath } from "#/integrations/supabase/utils.ts";

/**
 * Pathless layout shared by every auth screen (`/sign-in`, `/sign-up`).
 *
 * It owns the three things both screens would otherwise duplicate: the search
 * schema, the already-signed-in guard, and the centered panel chrome. Children
 * read `error` / `next` from this route's search, so adding a third screen
 * (reset password, say) costs only its own form.
 *
 * `next` is carried through the whole OAuth round trip: it arrives here from a
 * protected route, rides along on the provider redirect, and
 * `/api/auth/callback` sends the user to it once the session exists.
 */
const authSearchSchema = z.object({
	error: z.string().optional(),
	// Sanitized when present, but left absent when it is — emitting a default
	// here would make the parsed search differ from the incoming URL, and the
	// router would bounce through a normalizing redirect on every visit.
	next: z
		.string()
		.optional()
		.transform((value) =>
			value === undefined ? undefined : resolveRedirectPath(value),
		),
});

export const Route = createFileRoute("/_auth")({
	validateSearch: authSearchSchema,
	beforeLoad: async ({ search }) => {
		// Already signed in? Don't show an auth form, just go where they were
		// headed. Also covers the back button after a completed sign-in.
		const user = await fetchUser();
		if (user) throw redirect({ href: search.next ?? "/" });
	},
	component: AuthLayout,
});

function AuthLayout() {
	return (
		<main className="demo-page demo-center">
			<section className="demo-panel w-full max-w-md">
				<Outlet />
			</section>
		</main>
	);
}
