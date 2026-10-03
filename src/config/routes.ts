import {
  createLookupSchema, createVehicleSchema, escalationRulesUpdateSchema, listLookupsQuerySchema, listVehiclesQuerySchema,
  settingsUpdateSchema, shiftDefinitionsUpdateSchema, updateLookupSchema, updateVehicleSchema,
} from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireAuth, requireRole } from '../auth/middleware'
import { clientIp } from '../lib/http'
import { parseBody, parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import {
  createLookup, createVehicle, listEscalationRules, listLookups, listShiftDefinitions, listVehicles,
  updateEscalationRules, updateLookup, updateShiftDefinitions, updateVehicle,
} from './service'
import { getSettings, updateSettings } from './settings'

export const configRoutes = new Hono<AppEnv>()
const admin = requireRole('ADMIN')

configRoutes.get('/shift-definitions', requireAuth(), async (c) => c.json(await listShiftDefinitions()))
configRoutes.put('/shift-definitions', admin, async (c) =>
  c.json(await updateShiftDefinitions(currentUser(c), await parseBody(c, shiftDefinitionsUpdateSchema), clientIp(c))))

configRoutes.get('/escalation-rules', requireAuth(), async (c) => c.json(await listEscalationRules()))
configRoutes.put('/escalation-rules', admin, async (c) =>
  c.json(await updateEscalationRules(currentUser(c), await parseBody(c, escalationRulesUpdateSchema), clientIp(c))))

configRoutes.get('/settings', requireRole('ADMIN', 'DEPUTY_DIRECTOR'), async (c) => c.json(await getSettings()))
configRoutes.put('/settings', admin, async (c) =>
  c.json(await updateSettings(currentUser(c), await parseBody(c, settingsUpdateSchema), clientIp(c))))

configRoutes.get('/lookups', requireAuth(), async (c) => c.json(await listLookups(parseQuery(c, listLookupsQuerySchema))))
configRoutes.post('/lookups', admin, async (c) =>
  c.json(await createLookup(currentUser(c), await parseBody(c, createLookupSchema), clientIp(c)), 201))
configRoutes.patch('/lookups/:id', admin, async (c) => {
  const id = parseId(c)
  return c.json(await updateLookup(currentUser(c), id, await parseBody(c, updateLookupSchema), clientIp(c)))
})

configRoutes.get('/vehicles', requireAuth(), async (c) => c.json(await listVehicles(parseQuery(c, listVehiclesQuerySchema))))
configRoutes.post('/vehicles', admin, async (c) =>
  c.json(await createVehicle(currentUser(c), await parseBody(c, createVehicleSchema), clientIp(c)), 201))
configRoutes.patch('/vehicles/:id', admin, async (c) => {
  const id = parseId(c)
  return c.json(await updateVehicle(currentUser(c), id, await parseBody(c, updateVehicleSchema), clientIp(c)))
})
