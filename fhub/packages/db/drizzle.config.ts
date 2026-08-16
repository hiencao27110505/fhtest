import { defineConfig } from 'drizzle-kit'

// DATABASE_URL is owned by the consuming app, not this package. The root db:*
// scripts inject it for the commands that connect; `generate` never does, so an
// empty string here keeps schema generation working without a database.
export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})