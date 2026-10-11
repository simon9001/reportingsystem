import { reportQuerySchema, reportUpdateSchema } from '@sr/shared'
import { Hono } from 'hono'
import { currentUser, requireAuth, requireRole } from '../auth/middleware'
import { AppError } from '../lib/errors'
import { clientIp } from '../lib/http'
import { prisma } from '../lib/prisma'
import { parseBody, parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import { reportPdfFileName } from './pdf'
import { assertCanReadShiftReport, getReportById, getShiftReport, listReports, loadReportDto, setAfterSubmit, submitShiftReport, updateShiftReport } from './service'
import { ensureSubmittedPdf, reportPdf } from './storage'

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

reportsRoutes.get('/:id/pdf', requireAuth(), async (c) => {
  const id = parseId(c)
  const row = await prisma.shiftReport.findUnique({ where: { id }, include: { shift: true } })
  if (!row) throw new AppError('NOT_FOUND', 'Report not found')
  assertCanReadShiftReport(currentUser(c), row.shift)
  const buf = await reportPdf(id)
  const name = reportPdfFileName(await loadReportDto(id))
  return c.body(new Uint8Array(buf), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  })
})

setAfterSubmit(async (id) => { await ensureSubmittedPdf(id) })
