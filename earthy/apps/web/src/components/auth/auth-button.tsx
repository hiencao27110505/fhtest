import type { ReactNode } from "react";
import { Fragment, useState } from "react";

/** What an auth action reports back. `null` error means it worked. */
export interface AuthResult {
	error: string | null;
}

/**
 * Runs on click. Resolve with an `error` to surface it, or with nothing on
 * success — an action that only ever succeeds or throws can return `void`.
 */
// A caller-supplied action legitimately returns nothing: `signOut` is
// `Promise<void>`, and narrowing this to `undefined` would mean reshaping the
// provider just to satisfy the lint.
// biome-ignore lint/suspicious/noConfusingVoidType: see above
export type AuthAction = () => Promise<AuthResult | undefined | void>;

/**
 * The behaviour every auth control shares: run an async action, hold a pending
 * flag while it is in flight, and report failure back up.
 *
 * Split out from the buttons because that logic is the only thing they have in
 * common — a panel CTA and a header pill look nothing alike, so they share this
 * and keep their own markup.
 *
 * Pending state belongs to the click rather than the screen, so each control
 * gets its own: two buttons on one page disable independently.
 */
export function useAuthAction(onError?: (message: string | null) => void) {
	const [pending, setPending] = useState(false);

	const run = async (action: AuthAction) => {
		setPending(true);
		onError?.(null);

		try {
			const result = await action();
			// Only unwind on failure. On success a redirect flow is already
			// navigating away, and clearing `pending` would flash the idle button.
			if (result?.error) {
				onError?.(result.error);
				setPending(false);
			}
		} catch (cause) {
			// A thrown action is still a failed action, not a broken page.
			onError?.(cause instanceof Error ? cause.message : String(cause));
			setPending(false);
		}
	};

	return { pending, run };
}

/**
 * The full-width CTA on the auth screens.
 *
 * It knows nothing about *which* provider it triggers — the caller passes
 * `onAuth`, so adding Apple or a magic link is a new call site, not a change
 * here.
 */
export default function AuthButton({
	onAuth,
	label,
	icon,
	pendingLabel = "Redirecting",
	onError,
	disabled = false,
	className = "",
}: {
	onAuth: AuthAction;
	label: ReactNode;
	icon?: ReactNode;
	pendingLabel?: ReactNode;
	onError?: (message: string | null) => void;
	disabled?: boolean;
	className?: string;
}) {
	const { pending, run } = useAuthAction(onError);

	return (
		<button
			type="button"
			onClick={() => void run(onAuth)}
			disabled={pending || disabled}
			className={`demo-button flex w-full items-center justify-center gap-2 ${className}`}
		>
			{pending ? (
				<Fragment>
					<span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-white dark:border-neutral-600 dark:border-t-neutral-900" />
					<span>{pendingLabel}</span>
				</Fragment>
			) : (
				<Fragment>
					{icon}
					<span>{label}</span>
				</Fragment>
			)}
		</button>
	);
}

/**
 * The sign-out pill, sized for the header rather than a panel.
 *
 * Shares `useAuthAction` with `AuthButton` but not its markup: this one sits
 * beside an avatar in a 9-unit-tall row, so it is a bordered chip, not a
 * full-width CTA.
 *
 * Unlike sign-in there is no provider redirect to wait on — the page stays put
 * and the header re-renders signed-out — so it swaps its label rather than
 * showing a spinner.
 */
export function SignOutButton({
	onSignOut,
	label = "Sign out",
	pendingLabel = "Signing out",
	onError,
	disabled = false,
	className = "",
}: {
	onSignOut: AuthAction;
	label?: ReactNode;
	pendingLabel?: ReactNode;
	onError?: (message: string | null) => void;
	disabled?: boolean;
	className?: string;
}) {
	const { pending, run } = useAuthAction(onError);

	return (
		<button
			type="button"
			onClick={() => void run(onSignOut)}
			disabled={pending || disabled}
			className={`inline-flex h-9 items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 text-sm font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60 ${className}`}
		>
			{pending ? pendingLabel : label}
		</button>
	);
}
