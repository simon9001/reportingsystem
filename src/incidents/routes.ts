import { incidentInputSchema } from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireAuth } from '../auth/middleware'
import { clientIp } from '../lib/http'
import { parseBody, parseId } from '../lib/validate'
import type { AppEnv } from '../types'
import { createIncident, getIncident, updateIncident } from './service'

export const incidentsRoutes = new Hono<AppEnv>()

incidentsRoutes.post('/', requireAuth(), async (c) => {
  const input = await parseBody(c, incidentInputSchema)
  return c.json(await createIncident(currentUser(c), input, clientIp(c)), 201)
})

incidentsRoutes.get('/:idOrRef', requireAuth(), async (c) => c.json(await getIncident(c.req.param('idOrRef'), currentUser(c))))

incidentsRoutes.patch('/:id', requireAuth(), async (c) => {
  const id = parseId(c)
  const input = await parseBody(c, incidentInputSchema)
  return c.json(await updateIncident(currentUser(c), id, input, clientIp(c)))
})
