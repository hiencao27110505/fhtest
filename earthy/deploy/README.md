# Deploying `@earthy/api` to Cloud Run

| File | What it is |
|---|---|
| `../apps/api/Dockerfile` | Bun image. Build context is `earthy/` (not `apps/api/`) — it needs the lockfile and `packages/db`. |
| `../.dockerignore` | Keeps `apps/web`, `serverless/`, and every `.env` out of the build context. |
| `setup.sh` | One-time: APIs, Artifact Registry, runtime service account, empty secrets, IAM, push trigger. Idempotent. |
| `service.yaml` | The service definition — env vars, secret bindings, scaling, probes. **Owns configuration.** |
| `cloudbuild.yaml` | build → push → `gcloud run deploy --image`. **Owns the image only.** |
| `deploy.sh` | Manual deploy from a laptop; submits `cloudbuild.yaml` to Cloud Build. |
| `../.gcloudignore` | Keeps the *upload* context small. Without it `gcloud builds submit` uploaded 786 MB of `node_modules`; with it, 291 KB. Distinct from `.dockerignore`, which scopes the build itself. |

## Why config and image are split

`cloudbuild.yaml` deploys with `--image` and nothing else. If a routine code
deploy also passed `--set-env-vars`, any variable missing from that flag list
would be dropped from the revision — and `src/lib/env.ts` exits at import time
on a missing variable, so the failure mode is a service that will not boot.
Configuration changes go through `gcloud run services replace service.yaml`,
deliberately and on their own.

## First time

```sh
cd earthy
PROJECT_ID=my-proj GITHUB_OWNER=me GITHUB_REPO=fhtest ./deploy/setup.sh
```

Then follow the four steps it prints: fill the secrets, edit and apply
`service.yaml`, run the first build, and register the OAuth callback.

## Routine deploys

Push to `main` (the trigger only fires for changes under `apps/api`,
`packages/db`, `deploy/`, or the lockfile), or run:

```sh
PROJECT_ID=my-proj ./deploy/deploy.sh
```

## Things that bite

- **`PORT`** is injected by Cloud Run (8080). `env.ts` coerces it and
  `index.ts` binds it, so nothing needs setting. Do not put `PORT` in
  `service.yaml` — Cloud Run rejects the revision.
- **`WEB_ORIGINS`** must list the deployed web origin exactly. The API sends
  credentialed CORS responses, which cannot use `*`; a wrong value fails every
  browser fetch before it reaches a route.
- **`GOOGLE_OAUTH_REDIRECT_URI`** must match the Google client registration
  character for character, including the `.a.run.app` host. Chicken-and-egg:
  the URL only exists after the first deploy, so deploy once, read the URL,
  then update both the OAuth client and `service.yaml`.
- **Database connections.** Each instance holds a `pg` pool, so `maxScale: 10`
  is a connection budget, not just a cost cap. Raise it and Postgres, not
  Cloud Run, is what runs out.
- **Shutdown** takes up to 30s (`SHUTDOWN_TIMEOUT_MS`). The container runs Bun
  as PID 1 via the exec-form `CMD` so SIGTERM actually reaches it.
- **`GMAIL_TOKEN_KEY`** must be the same Fernet key `serverless/` uses, or
  tokens written by the API are undecryptable by the Python jobs.


## Deployed state (asia-southeast1, project fhtest-502915)

- Service: `earthy-api` → https://earthy-api-860668973723.asia-southeast1.run.app
- Runtime SA: `earthy-api-run@fhtest-502915.iam.gserviceaccount.com` (secret access only)
- Public (`allUsers` / `run.invoker`) **by necessity**: the OAuth callback is hit
  by a browser with no Google identity, and so is the web app. Authorisation is
  the app's own — `requireAuth` verifies the Supabase JWT, CORS is limited to
  the app origin, and the callback trusts only its own signed state.

## Two things that bit, and why

**BuildKit is not on by default in Cloud Build.** `gcr.io/cloud-builders/docker`
runs the legacy builder, so `RUN --mount=type=cache` fails with "the --mount
option requires BuildKit" — while the same Dockerfile builds fine on a laptop,
because Docker Desktop enables BuildKit. `cloudbuild.yaml` sets
`DOCKER_BUILDKIT=1`, and passes `BUILDKIT_INLINE_CACHE=1` so the pushed image
carries the cache metadata the next `--cache-from` needs.

**`.dockerignore` does not shrink the upload.** `gcloud builds submit` tars the
whole directory before Docker ever sees it, so the ignore file that matters for
upload size is `.gcloudignore`.

## Where the image size actually goes

Measured, arm64 local build:

| Layer | Size |
|---|---|
| Bun runtime binary | **87 MB (69%)** |
| `node_modules` | 26 MB |
| Alpine rootfs | 8.6 MB |
| Our source | ~78 KB |

**Pruning dependencies cannot move this** — the bulk is the Bun runtime, which
every supported base carries.

### Bases actually measured (uncompressed, arm64)

| Base | Size |
|---|---|
| `oven/bun:1.3-alpine` (ours) | **101 MB** |
| `oven/bun:1-distroless` | 107 MB |

Published comparisons quoting ~42 MB alpine / ~43 MB distroless are **compressed
registry** sizes, and they rank the two the other way round from what a local
pull shows. Switching to distroless would make this image ~6 MB *bigger*, and
`oven/bun:1-distroless` runs as **root** (`User=0`), not nonroot — we drop to
`USER bun` explicitly, so alpine is also the better security posture here.

### `bun build --compile` was considered and rejected

It embeds the whole Bun runtime plus JSC, so a compiled binary lands at roughly
the same size as what we already ship — while adding cross-libc build risk and
the class of bugs where a dynamic `require`/`import` is silently not bundled.
The one genuine draw is `--bytecode` for cold-start latency; if cold starts ever
matter here, `--min-instances=1` is the cheaper, more direct fix.
