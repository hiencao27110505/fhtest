import {
  bigint,
  boolean,
  customType,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const todos = pgTable('todos', {
  id: serial().primaryKey(),
  title: text().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

/**
 * OAuth links between an app user and their account at an external provider.
 *
 * Mirrors migration 0070 in `supabase/migrations/`, which remains the source of
 * truth: this table is created and altered there, and is declared here only so
 * the API can query it in a typed way. Do NOT `drizzle-kit push` against it.
 *
 * `refreshTokenEnc` is ciphertext — a Fernet token, in the format the Python
 * pipeline decrypts. It is never selected by this app; it is written and then
 * only ever read by the background jobs.
 */
export const connectedAccounts = pgTable('connected_accounts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull(),
  provider: text().notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  email: text(),
  refreshTokenEnc: customType<{ data: Uint8Array }>({
    dataType: () => 'bytea',
  })('refresh_token_enc').notNull(),
  scopes: text().notNull().default(''),
  needsReauth: boolean('needs_reauth').notNull().default(false),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
