import { Hono } from 'hono'
import { type AuthEnv, requireAuth } from '@/middleware/auth'

/**
 * PLACEHOLDER private routes, demonstrating the authenticated chain.
 *
 * `requireAuth` is attached per route rather than via `.use('*', ...)`: this
 * chain is mounted at the root, where a wildcard would run auth before the
 * router rules a path out, turning every unknown URL into a 401 instead of a
 * 404. Listing it per route keeps the guard on exactly these paths.
 */
export const privateRoutes = new Hono<AuthEnv>()
  .get('/me', requireAuth, (c) => {
    const user = c.get('user')
    return c.json(user)
  })
  .get('/private/demo', requireAuth, (c) => {
    const user = c.get('user')
    return c.json({ message: `Hello ${user.email}, this route is private.` })
  })
