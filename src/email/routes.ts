import { emailJobQuerySchema, type EmailJobDto, type EmailJobStatus, type EmailJobType } from '@sr/shared'
import { Hono } from 'hono'
import { writeAudit } from '../audit/audit'
import { currentUser, requireRole } from '../auth/middleware'
import { publish } from '../events/bus'
import { AppError } from '../lib/errors'
import { clientIp } from '../lib/http'
import { prisma } from '../lib/prisma'
import { parseId, parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import { queueEmail } from './queue'
import { smtpStatus } from './transport'

export const adminEmailRoutes = new Hono<AppEnv>()
adminEmailRoutes.use('*', requireRole('ADMIN'))

adminEmailRoutes.get('/email/status', (c) => c.json(smtpStatus()))

adminEmailRoutes.get('/email-jobs', async (c) => {
  const q = parseQuery(c, emailJobQuerySchema)
  const where = q.status ? { status: q.status } : {}
  const pageSize = 25
  const [total, rows] = await Promise.all([
    prisma.emailJob.count({ where }),
    prisma.emailJob.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * pageSize, take: pageSize }),
  ])
  const items: EmailJobDto[] = rows.map((j) => ({
    id: j.id, type: j.type as EmailJobType, to: j.to, status: j.status as EmailJobStatus, attempts: j.attempts, lastError: j.lastError,
    reportId: j.reportId, createdAt: j.createdAt.toISOString(), nextAttemptAt: j.nextAttemptAt.toISOString(), sentAt: j.sentAt?.toISOString() ?? null,
  }))
  return c.json({ items, total, page: q.page, pageSize })
})

adminEmailRoutes.post('/email-jobs/:id/retry', async (c) => {
  const id = parseId(c)
  const job = await prisma.emailJob.findUnique({ where: { id } })
  if (!job) throw new AppError('NOT_FOUND', 'Email not found')
  if (!['FAILED', 'SKIPPED_NO_SMTP'].includes(job.status)) throw new AppError('CONFLICT', 'Only failed or skipped emails can be retried')
  await prisma.$transaction(async (tx) => {
    await tx.emailJob.update({ where: { id }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, lockedAt: null } })
    await writeAudit(tx, { userId: currentUser(c).id, entity: 'EmailJob', entityId: id, action: 'UPDATE', before: { status: job.status }, after: { status: 'PENDING' }, ip: clientIp(c) })
  })
  publish('audit')
  return c.json({ ok: true })
})

adminEmailRoutes.post('/email/test', async (c) => {
  const actor = currentUser(c)
  await prisma.$transaction(async (tx) => {
    await queueEmail(tx, { type: 'TEST', to: actor.email, createdById: actor.id })
    await writeAudit(tx, { userId: actor.id, entity: 'EmailJob', action: 'CREATE', after: { type: 'TEST', to: actor.email }, ip: clientIp(c) })
  })
  publish('audit')
  return c.json({ ok: true }, 202)
})
