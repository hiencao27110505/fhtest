import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import AuthButton from "#/components/auth/auth-button.tsx";
import { GoogleMark } from "#/components/auth/provider-marks.tsx";
import { useAuthActions } from "#/providers/auth/root-provider.tsx";

/**
 * Sign-in screen, and the landing spot for every auth failure — the callback
 * and verify routes both redirect here with `?error=...`.
 *
 * The panel chrome, search schema, and signed-in guard all live in the `_auth`
 * layout; this file is just the copy and the button.
 */
export const Route = createFileRoute("/_auth/sign-in")({
	component: SignInPage,
});

function SignInPage() {
	const { error, next } = Route.useSearch();
	const { signInWithGoogle } = useAuthActions();
	const [clientError, setClientError] = useState<string | null>(null);

	const message = clientError ?? error;

	return (
		<>
			<p className="island-kicker mb-2">Sign in</p>
			<h1 className="demo-title">Welcome back</h1>
			<p className="demo-muted mt-2 mb-6 text-sm">
				Continue with your Google account to keep going.
			</p>

			{message && (
				<div className="demo-alert demo-alert-danger mb-4" role="alert">
					<p className="text-sm text-red-600">{message}</p>
				</div>
			)}

			<AuthButton
				onAuth={() => signInWithGoogle(next ?? "/")}
				icon={<GoogleMark />}
				label="Continue with Google"
				onError={setClientError}
			/>

			<p className="demo-muted mt-6 text-center text-sm">
				New here?{" "}
				<Link to="/sign-up" search={{ next }} className="font-semibold">
					Create an account
				</Link>
			</p>
		</>
	);
}
