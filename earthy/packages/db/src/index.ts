import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema.ts";

export const db = drizzle(process.env.DATABASE_URL ?? "", { schema });

/**
 * The underlying `pg` connection pool. Exposed so the server can drain it on
 * shutdown; prefer `db` for all querying.
 */
export const pool = db.$client;

export { schema };

export * from "./schema.ts";
