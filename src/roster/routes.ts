import { copyWeekSchema, rosterRangeQuerySchema, rosterUpsertSchema } from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireAuth, requireRole } from '../auth/middleware'
import { clientIp } from '../lib/http'
import { parseBody, parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import { copyWeek, deleteRosterShift, getCurrentShift, listRoster, upsertRoster } from './service'

export const rosterRoutes = new Hono<AppEnv>()
const planners = requireRole('ADMIN', 'DEPUTY_DIRECTOR')

rosterRoutes.get('/', requireAuth(), async (c) => {
  const { from, to } = parseQuery(c, rosterRangeQuerySchema)
  return c.json(await listRoster(from, to))
})

rosterRoutes.get('/current', requireAuth(), async (c) => c.json(await getCurrentShift(currentUser(c).id)))

rosterRoutes.put('/', planners, async (c) => {
  const { entries } = await parseBody(c, rosterUpsertSchema)
  return c.json(await upsertRoster(currentUser(c), entries, clientIp(c)))
})

rosterRoutes.post('/copy-week', planners, async (c) => {
  const input = await parseBody(c, copyWeekSchema)
  return c.json(await copyWeek(currentUser(c), input, clientIp(c)))
})

rosterRoutes.delete('/:id', planners, async (c) => {
  await deleteRosterShift(currentUser(c), parseId(c), clientIp(c))
  return c.body(null, 204)
})
