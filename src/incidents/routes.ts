import { incidentInputSchema, incidentQuerySchema } from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireAuth, requireRole } from '../auth/middleware'
import { assertCanUpload, uploadAttachments } from '../attachments/service'
import { AppError } from '../lib/errors'
import { clientIp } from '../lib/http'
import { parseBody, parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import { buildIncidentWorkbook } from './export'
import { listIncidents } from './query'
import { createIncident, getIncident, updateIncident } from './service'

export const incidentsRoutes = new Hono<AppEnv>()

incidentsRoutes.post('/', requireAuth(), async (c) => {
  const input = await parseBody(c, incidentInputSchema)
  return c.json(await createIncident(currentUser(c), input, clientIp(c)), 201)
})

incidentsRoutes.get('/', requireAuth(), async (c) => c.json(await listIncidents(parseQuery(c, incidentQuerySchema))))

incidentsRoutes.get('/export.xlsx', requireRole('DEPUTY_DIRECTOR', 'ADMIN'), async (c) => {
  const q = parseQuery(c, incidentQuerySchema)
  const { buffer: buf, truncated } = await buildIncidentWorkbook(q)
  const name = `incidents${q.side ? `-${q.side.toLowerCase()}` : ''}${q.from ? `-${q.from}` : ''}${q.to ? `-to-${q.to}` : ''}.xlsx`
  return c.body(new Uint8Array(buf), 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${name}"`,
    ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
  })
})

incidentsRoutes.get('/:idOrRef', requireAuth(), async (c) => c.json(await getIncident(c.req.param('idOrRef'), currentUser(c))))

incidentsRoutes.patch('/:id', requireAuth(), async (c) => {
  const id = parseId(c)
  const input = await parseBody(c, incidentInputSchema)
  return c.json(await updateIncident(currentUser(c), id, input, clientIp(c)))
})

incidentsRoutes.post('/:id/attachments', requireAuth(), async (c) => {
  const id = parseId(c)
  await assertCanUpload(currentUser(c), id)
  const body = await c.req.parseBody({ all: true })
  const raw = body['files']
  const files = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((f): f is File => f instanceof File)
  if (files.length === 0) throw new AppError('VALIDATION_ERROR', 'Choose at least one file', { files: 'Choose at least one file' })
  return c.json(await uploadAttachments(currentUser(c), id, files, clientIp(c)), 201)
})
