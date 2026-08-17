import { Link } from "@tanstack/react-router";
import { SignOutButton } from "#/components/auth/auth-button.tsx";
import Skeleton from "#/components/ui/skeleton.tsx";
import {
  useAuthActions,
  useAuthProfile,
  useAuthStatus,
} from "#/providers/auth/root-provider.tsx";

/**
 * Header session widget.
 *
 * No subscription or local state of its own — it reads slices from the auth
 * store and renders. The single `onAuthStateChange` listener lives in
 * `AuthProvider`, so adding more session-aware components costs nothing.
 */
export default function AuthHeaderUser() {
  const status = useAuthStatus();
  const profile = useAuthProfile();
  const { signOut } = useAuthActions();

  console.log("profile", profile);
  console.debug("status", status)

  if (status === "loading") {
    return <Skeleton className="h-8 w-20 rounded-full" />;
  }

  if (status === "anonymous") {
    return (
      <Link
        to="/sign-in"
        search={{}}
        className="inline-flex h-8 items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-4 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5"
      >
        Sign in
      </Link>
    );
  }

  const label = profile.name ?? "Account";

  return (
    <div className="flex items-center gap-2">
      {profile.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt=""
          className="h-8 w-8 rounded-full border border-[var(--chip-line)]"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)]">
          <span className="text-xs font-medium text-[var(--sea-ink-soft)]">
            {label.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <SignOutButton onSignOut={signOut} />
    </div>
  );
}
