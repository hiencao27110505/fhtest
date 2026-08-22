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