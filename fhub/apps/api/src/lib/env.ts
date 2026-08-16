import { z } from 'zod'

/**
 * Validated server environment. Bun loads `.env.local` automatically, so this
 * only has to check what landed in `process.env`.
 *
 * Parsing at import time means a missing or malformed value fails at boot with
 * a readable message, instead of surfacing as a confusing connection error on
 * the first request.
 */
const schema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql'),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment:')
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data