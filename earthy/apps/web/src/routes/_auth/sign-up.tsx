import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import AuthButton from "#/components/auth/auth-button.tsx";
import { GoogleMark } from "#/components/auth/provider-marks.tsx";
import { useAuthActions } from "#/providers/auth/root-provider.tsx";

/**
 * Sign-up screen.
 *
 * Mechanically the same Google round trip as sign-in — the provider creates the
 * account when it doesn't exist yet, so there is no separate registration call
 * to make. It's a distinct route because arriving at "Create your account"
 * rather than "Welcome back" is the whole difference for a new user.
 */
export const Route = createFileRoute("/_auth/sign-up")({
	component: SignUpPage,
});

function SignUpPage() {
	const { error, next } = Route.useSearch();
	const { signInWithGoogle } = useAuthActions();
	const [clientError, setClientError] = useState<string | null>(null);

	const message = clientError ?? error;

	return (
		<>
			<p className="island-kicker mb-2">Sign up</p>
			<h1 className="demo-title">Create your account</h1>
			<p className="demo-muted mt-2 mb-6 text-sm">
				Use your Google account and you're set. Nothing else to fill in.
			</p>

			{message && (
				<div className="demo-alert demo-alert-danger mb-4" role="alert">
					<p className="text-sm text-red-600">{message}</p>
				</div>
			)}

			<AuthButton
				onAuth={() => signInWithGoogle(next ?? "/")}
				icon={<GoogleMark />}
				label="Sign up with Google"
				onError={setClientError}
			/>

			<p className="demo-muted mt-6 text-center text-sm">
				Already have an account?{" "}
				<Link to="/sign-in" search={{ next }} className="font-semibold">
					Sign in
				</Link>
			</p>
		</>
	);
}
