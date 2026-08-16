# @fhub/db

Drizzle ORM schema and Postgres client for FamilyHub. Everything that touches the
database lives here; apps import it and never talk to `drizzle-orm` directly.

## Usage

```ts
import { db, todos } from '@fhub/db'
import { desc } from 'drizzle-orm'

await db.query.todos.findMany({ orderBy: [desc(todos.createdAt)] })
```

`@fhub/db/schema` exposes the table definitions on their own, for consumers that
want the schema without instantiating a connection.

## Environment

This package holds no `.env` of its own. `DATABASE_URL` comes from the consuming
app, which is where env is declared and validated — one source of truth, and no
copy of a credential sitting in `packages/`.

At runtime the app's environment supplies it. For the drizzle-kit CLI, run the
scripts **from the repo root**, where they inject the app's env file before
invoking the command. Running them directly inside this package fails fast with a
message telling you to use the root scripts.

## Scripts

Run these from the repo root, not this directory.

| Script | What it does |
|---|---|
| `db:generate` | Generate SQL migrations from `src/schema.ts` into `drizzle/` (no database needed) |
| `db:migrate` | Apply pending migrations |
| `db:push` | Push the schema straight to the database (dev only) |
| `db:pull` | Introspect an existing database into a schema |
| `db:studio` | Open Drizzle Studio |