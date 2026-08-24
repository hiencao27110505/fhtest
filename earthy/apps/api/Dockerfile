# syntax=docker/dockerfile:1

# Cloud Run image for @earthy/api.
#
# The API is a Bun + Hono server inside a pnpm workspace, and it imports
# @earthy/db by TypeScript source (`"exports": "./src/index.ts"`). There is no
# compile step to copy artifacts from, so the runtime image carries the source
# of both packages plus their installed node_modules, and Bun transpiles on
# import. The two stages exist to keep dev dependencies and the pnpm store out
# of the final layer, not to produce a bundle.
FROM oven/bun:1.3-alpine AS deps

WORKDIR /repo

# pnpm resolves workspace:^ links, so the manifests must be present with the
# same relative layout as the repo before install runs. Copying only the
# manifests first keeps this layer cached across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/

# --filter with ...^ pulls in the workspace dependencies @earthy/api links to
# (packages/db) and nothing else — apps/web and packages/ui never install.
# pnpm comes from `bun install -g`, not corepack: the oven/bun image ships no
# Node runtime, so corepack does not exist in it. The version is pinned to the
# repo's packageManager field so the lockfile is read by the same pnpm that
# wrote it.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install -g pnpm@10.33.4
ENV PATH="/root/.bun/bin:$PATH"

RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store \
 && pnpm install --frozen-lockfile --prod --filter @earthy/api...


FROM oven/bun:1.3-alpine AS runtime

WORKDIR /repo

ENV NODE_ENV=production

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/db ./packages/db
COPY apps/api ./apps/api

# The base image ships a `bun` user; running as it means a container escape
# does not land on root. Nothing is written to disk at runtime, so read
# ownership of /repo is all that is needed.
USER bun

WORKDIR /repo/apps/api

# Cloud Run injects PORT (8080 by default) and the env schema coerces it, so
# nothing here needs to hardcode it. EXPOSE is documentation only.
EXPOSE 8080

# Exec form, no shell wrapper: Bun must be PID 1 so it receives the SIGTERM
# Cloud Run sends at shutdown — src/index.ts drains in-flight requests and
# closes the pg pool on that signal, and a shell parent would swallow it.
CMD ["bun", "run", "src/index.ts"]
