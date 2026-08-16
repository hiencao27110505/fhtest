import { createFileRoute } from "@tanstack/react-router";
import { Route as AuthedRoute } from "./route.ts";

/**
 * A protected page, and the working example of the `_authed` guard: reaching
 * `/dashboard` while signed out bounces to `/sign-in?next=/dashboard`, and the
 * callback returns here once the session exists.
 */
export const Route = createFileRoute("/_authed/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = AuthedRoute.useRouteContext();

  return (
    <main className="demo-page">
      <section className="demo-panel">
        <p className="island-kicker mb-2">Protected</p>
        <h1 className="demo-title">Dashboard</h1>
        <p className="demo-muted mt-2 text-sm">
          You only see this because `_authed` verified your session on the
          server before this route rendered.
        </p>

        <dl className="mt-6 grid gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="demo-muted">Name</dt>
            <dd className="font-medium">{user?.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="demo-muted">Email</dt>
            <dd className="font-medium">{user?.email ?? "—"}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
