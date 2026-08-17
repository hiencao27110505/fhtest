import { zValidator } from '@hono/zod-validator'
// import { db, todos } from '@earthy/db'
// import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
// import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

const idParam = z.object({ id: z.coerce.number().int().positive() })

/**
 * Todo routes. Kept as a single method chain so `hono/client` can infer the
 * route types from the mounted app.
 */
export const todosRoutes = new Hono()
  .get('/todos', async (c) => {
    // const rows = await db.select().from(todos).orderBy(desc(todos.createdAt))
    return c.json([])
  })
  .get('/todos/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    // const [row] = await db.select().from(todos).where(eq(todos.id, id))
    // if (!row) throw new HTTPException(404, { message: 'Todo not found' })
    return c.json({ id })
  })
  .post(
    '/todos',
    zValidator('json', z.object({ title: z.string().min(1).max(255) })),
    async (c) => {
      const { title } = c.req.valid('json')
      // const [row] = await db.insert(todos).values({ title }).returning()
      return c.json({ title }, 201)
    },
  )
  .delete('/todos/:id', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param')
    // const [row] = await db.delete(todos).where(eq(todos.id, id)).returning()
    // if (!row) throw new HTTPException(404, { message: 'Todo not found' })
    return c.json({ id })
  })
