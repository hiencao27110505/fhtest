# @earthy/api

Hono API server running on Bun. Reads and writes through `@earthy/db` — it never
opens its own connection or defines its own tables.

## Running

```sh
pnpm --filter @earthy/api dev     # watch mode on http://localhost:3001
pnpm --filter @earthy/api start   # no watcher
```

Bun loads `.env.local` automatically. Copy `.env.example` to `.env.local` and set
`DATABASE_URL`; `src/lib/env.ts` validates it at boot and exits with a readable
message if it is missing or malformed.

## Layout

| File | Role |
|---|---|
| `src/index.ts` | Server entry — binds the port, nothing else |
| `src/app.ts` | The Hono app and routes, importable without binding a port |
| `src/lib/env.ts` | Zod-validated environment, parsed at import time |
| `src/features/<name>/` | One feature, whole: HTTP, flow, SQL, and whatever else only it uses |
| `src/lib/` | Only what more than one feature needs |

A feature owns everything only it uses. `features/connections/` holds its own
OAuth client, state signing, and Fernet encryption alongside its routes, rather
than scattering them into `lib/` — nothing else calls them, and a shared folder
would imply otherwise. Code moves to `lib/` when a second caller appears, not in
anticipation of one.

Inside a feature the layering is by what a file talks to, so each is testable
alone: `routes` parses and renders, `service` holds the flow and takes its
collaborators as arguments, `repository` is the only place that writes a table.
A rule about a table's constraints belongs in its repository — that is the layer
a test can point at the real DDL.

`app.ts` exports `AppType`, so a client can get end-to-end typed routes:

```ts
import { hc } from 'hono/client'
import type { AppType } from '@earthy/api/app'

const client = hc<AppType>('http://localhost:3001')
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/api/todos` | List todos, newest first |
| `GET` | `/api/todos/:id` | Fetch one todo |
| `POST` | `/api/todos` | Create a todo — `{ "title": string }` |
| `DELETE` | `/api/todos/:id` | Delete a todo |
## Testing

```sh
pnpm --filter @earthy/api test
```

`bunfig.toml` preloads `src/test-env.ts`, which fills in placeholder values for
the boot-time environment check. Two suites need more than that and skip
themselves when it is missing rather than failing:

| Suite | Needs | Why it is not mocked |
|---|---|---|
| `features/connections/repository.test.ts` | `TEST_DATABASE_URL` | Its subject is the two unique constraints on `connected_accounts`. A mocked handle accepts writes that a real table rejects, so a mocked test would pass on the exact bugs these cases pin down. |
| `features/connections/fernet.test.ts` | `serverless/.venv` | Its subject is that the Python pipeline can decrypt what this writes. Only Python can answer that. |

To run the repository suite against a throwaway database:

```sh
createdb oauthtest
# The migration is written for Supabase: it grants to anon/authenticated/
# service_role and the table's user_id is a FK onto auth.users. On a plain
# Postgres none of that exists, so create it first — without the roles, every
# grant in the migration aborts and the RLS it enables is left with no way in.
psql -d oauthtest -c "
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users values
    ('11111111-1111-1111-1111-111111111111','a@example.com'),
    ('22222222-2222-2222-2222-222222222222','b@example.com');"
psql -d oauthtest -f ../../../supabase/migrations/0070_connected_accounts.sql
TEST_DATABASE_URL=postgresql://localhost/oauthtest pnpm --filter @earthy/api test
```

Those two uuids are the suite's fixtures, not arbitrary — the tests insert links
for them by id.

## Connecting a Gmail mailbox

The web equivalent of `serverless/tools/connect_mailbox.py`, writing the same
row in the same format — the CLI stays the operator path, this is the one a user
walks themselves.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/connections` | The caller's links. Never includes the ciphertext |
| `GET` | `/connections/:provider/authorize?returnTo=/path` | `302` to the provider's consent screen |
| `DELETE` | `/connections/:provider` | Removes the link. Does not revoke the grant at the provider |
| `GET` | `/connections/callback` | The provider redirects here; ends in a redirect to `OAUTH_SUCCESS_REDIRECT` or `OAUTH_FAILURE_REDIRECT?reason=<kind>` |

### Adding a provider

`providers.ts` is the registry. A new integration is a record there plus its
OAuth client module — the endpoints above are already parameterised by
`:provider` and do not change.

Note that the **callback has no provider segment**: one endpoint serves all of
them, with the provider read from the signed `state`. That is deliberate. Each
distinct redirect URI has to be registered by hand in that provider's console,
so `/connections/:provider/callback` would mean console work before any new
integration could run at all. Signing the provider also means a callback cannot
be steered into exchanging a code against the wrong provider's client.

Authorize answers `302`, so starting the flow needs no client code at all:

```html
<a href="/api/connections/google/authorize?returnTo=/settings">Connect Gmail</a>
```

**This depends on the API being served from the same site as the web app**
(`app.example.com` and `api.example.com`, say). The Supabase session cookie is
`SameSite=Lax`, which browsers send on exactly this kind of request — a
top-level GET navigation — so `requireAuth` sees the caller and can sign a state
naming them.

Move the API to a different site and this breaks: the cookie belongs to the web
app's host, so a navigation to another site carries nothing and every authorize
401s. The fix then is to return the URL as JSON and have the page `fetch` it
with `credentials: "include"`, then assign `window.location`. A `fetch` cannot
act on a cross-origin redirect in either mode — `follow` chases it to the
provider, which sends no CORS headers, and `manual` yields an
[`opaqueredirect`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
response whose `Location` is hidden from JavaScript. Note that on localhost the
same-site condition holds even across ports (cookies ignore the port), so this
failure appears only at deploy time.

`returnTo` travels inside the signed state, never as a query parameter Google
echoes back — that would be an open redirect. It is also reduced to a same-site
path before use, so the redirect cannot leave `OAUTH_SUCCESS_REDIRECT`'s origin
even if a signed state leaked. Both endings honour it, a declined consent
included: cancelling is the most ordinary way this flow ends, and dropping the
user on a default page is the wrong place to tell them about it.

`WEB_ORIGINS` must list the browser app's origin. The API accepts the Supabase
session cookie, and browsers reject a credentialed response whose
`Access-Control-Allow-Origin` is `*` — a bare `cors()` breaks every
cookie-authenticated call from the web app.

The `reason` values on a failed callback are the `kind` field of
`ConnectFailure` in `features/connections/errors.ts`; renaming one is a breaking
change for the settings page that reads it.

### Why this is separate from signing in

Signing in with Google (`signInWithOAuth`, in the web app) does NOT request the
Gmail scope — the `scopes` and `queryParams` lines in
`providers/auth/root-provider.tsx` are commented out on purpose. This flow is
the second, later consent: the user is already signed in, reaches for a feature
that reads their mail, and only then is asked for access to it. Google supports
exactly this as [incremental authorization](https://developers.google.com/identity/sign-in/web/incremental-auth) — the user sees a consent screen
for the new scope alone.

Folding the Gmail scope into sign-in instead would make every new user approve
mailbox access just to log in, including the ones who never touch the feature.

It would also not work, for a second reason. Supabase's docs are explicit that
[provider tokens are intentionally not stored in your project's database](https://supabase.com/docs/guides/auth/social-login)
and that "Supabase Auth does not manage refreshing the provider token" — the
same page recommends sending it "to a trusted and secure server you control".
A background pipeline needs a refresh token it can still read next week, so
capturing and storing one is work that has to happen somewhere. This is that
somewhere.

Two things this flow deliberately does not do:

* **It does not register the Gmail watch.** `gmail-watch-renew` owns that and
  seeds the history cursor when it does. Writing that cursor from two places
  risks one of them skipping the messages in between.
* **It does not move a mailbox between users.** A mailbox already linked to
  another account is refused (`reason=mailbox_taken`). Consent for a mailbox is
  not consent to take it off the account currently receiving its data.

## Authenticating a caller

`middleware/auth.ts` holds the whole path: it takes the access token from
`Authorization: Bearer …`, falls back to the session cookie the web app's
browser client writes, verifies it against the project's JWKS, and attaches the
caller as `c.get('user')`.

That cookie is not a bare JWT, which is the part worth knowing before touching
`middleware/auth.ts`. `@supabase/ssr` stores the whole session object:

```
sb-<project-ref>-auth-token = "base64-" + base64url(JSON.stringify(session))
```

Only `session.access_token` is a JWT. Sessions over 3180 bytes are split across
`…auth-token.0`, `…auth-token.1`, … and have to be concatenated in index order
before decoding — a session with sizeable `user_metadata` crosses that
threshold, so chunking is ordinary traffic, not an edge case.

The fixtures in `middleware/auth.test.ts` were checked against
`@supabase/ssr` 0.12.4 itself: each was handed back to `createServerClient`,
which recovered the same session from it. If that library changes its storage
format, those tests are what should be re-verified against it rather than
adjusted to match new behaviour.
