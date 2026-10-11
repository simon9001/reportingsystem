import { reportQuerySchema, reportUpdateSchema } from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireAuth, requireRole } from '../auth/middleware'
import { clientIp } from '../lib/http'
import { parseBody, parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import { getReportById, getShiftReport, listReports, submitShiftReport, updateShiftReport } from './service'

export const shiftReportRoutes = new Hono<AppEnv>()

shiftReportRoutes.get('/:shiftId/report', requireAuth(), async (c) => c.json(await getShiftReport(currentUser(c), parseId(c, 'shiftId'))))
shiftReportRoutes.put('/:shiftId/report', requireAuth(), async (c) => {
  const shiftId = parseId(c, 'shiftId')
  return c.json(await updateShiftReport(currentUser(c), shiftId, await parseBody(c, reportUpdateSchema), clientIp(c)))
})
shiftReportRoutes.post('/:shiftId/report/submit', requireAuth(), async (c) => c.json(await submitShiftReport(currentUser(c), parseId(c, 'shiftId'), clientIp(c))))

export const reportsRoutes = new Hono<AppEnv>()

reportsRoutes.get('/', requireRole('DEPUTY_DIRECTOR', 'ADMIN'), async (c) => c.json(await listReports(parseQuery(c, reportQuerySchema))))
reportsRoutes.get('/:id', requireAuth(), async (c) => c.json(await getReportById(currentUser(c), parseId(c))))
