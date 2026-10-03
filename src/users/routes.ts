import { createUserSchema, listUsersQuerySchema, resetPasswordSchema, updateUserSchema } from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireRole } from '../auth/middleware'
import { clientIp } from '../lib/http'
import { parseBody, parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import { createUser, listUsers, resetUserPassword, updateUser } from './service'

export const usersRoutes = new Hono<AppEnv>()

usersRoutes.get('/', requireRole('ADMIN', 'DEPUTY_DIRECTOR'), async (c) => {
  return c.json(await listUsers(parseQuery(c, listUsersQuerySchema)))
})

usersRoutes.post('/', requireRole('ADMIN'), async (c) => {
  const input = await parseBody(c, createUserSchema)
  return c.json(await createUser(currentUser(c), input, clientIp(c)), 201)
})

usersRoutes.patch('/:id', requireRole('ADMIN'), async (c) => {
  const id = parseId(c)
  const input = await parseBody(c, updateUserSchema)
  return c.json(await updateUser(currentUser(c), id, input, clientIp(c)))
})

usersRoutes.post('/:id/reset-password', requireRole('ADMIN'), async (c) => {
  const id = parseId(c)
  const { password } = await parseBody(c, resetPasswordSchema)
  await resetUserPassword(currentUser(c), id, password, clientIp(c))
  return c.body(null, 204)
})
