import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { queueEmail } from '../src/email/queue'
import type { MailMessage, Mailer } from '../src/email/transport'
import { nextAttemptDelayMinutes, queueOverdueReports, runEmailJobs } from '../src/email/worker'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, login, loginAs } from './factories'
import { resetIncidentSeq, setupIncidentWorld } from './incidentFixtures'

const app = createApp()
const sent: MailMessage[] = []
const okMailer: Mailer = { send: async (m) => { sent.push(m) } }
const badMailer: Mailer = { send: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:587 (user=cr@kenha.test pass=secret)') } }
let world: Awaited<ReturnType<typeof setupIncidentWorld>>

beforeEach(async () => {
  await resetDb()
  resetIncidentSeq()
  sent.length = 0
  world = await setupIncidentWorld()
  await prisma.systemSetting.upsert({ where: { key: 'ddEmails' }, create: { key: 'ddEmails', value: '["dd@kenha.test"]' }, update: { value: '["dd@kenha.test"]' } })
})
afterAll(() => prisma.$disconnect())

describe('email worker', () => {
  it('has the agreed backoff', () => {
    expect([1, 2, 3, 4, 5].map(nextAttemptDelayMinutes)).toEqual([1, 5, 15, 60, null])
  })

  it('sends a submitted report with the PDF attached', async () => {
    const { id } = await prisma.shiftReport.create({ data: { shiftId: world.current.id, overallStatus: 'NORMAL', overview: 'Calm', confirmReviewed: true, confirmEscalated: true, confirmHandedOver: true, confirmSubmitted: true } })
    // submit through the API so the snapshot exists
    const sup = await login(app, world.supervisor.email)
    expect((await call(app, 'POST', `/api/shifts/${world.current.id}/report/submit`, { cookie: sup })).status).toBe(200)
    const r = await runEmailJobs(new Date(), okMailer)
    expect(r).toEqual({ sent: 1, failed: 0, skipped: 0 })
    expect(sent[0]!.to).toBe('dd@kenha.test')
    expect(sent[0]!.subject).toMatch(/shift report — .* — Submitted on time$/)
    expect(sent[0]!.attachments?.[0]?.contentType).toBe('application/pdf')
    expect((await prisma.emailJob.findFirstOrThrow({ where: { reportId: id } })).status).toBe('SENT')
  })

  it('marks jobs skipped when SMTP is not configured', async () => {
    await queueEmail(prisma, { type: 'TEST', to: 'admin@kenha.test' })
    expect(await runEmailJobs(new Date(), null)).toEqual({ sent: 0, failed: 0, skipped: 1 })
    expect((await prisma.emailJob.findFirstOrThrow()).status).toBe('SKIPPED_NO_SMTP')
  })

  it('retries with backoff, strips credentials from the error, and fails after 5 attempts', async () => {
    await queueEmail(prisma, { type: 'TEST', to: 'admin@kenha.test' })
    let now = new Date()
    for (let attempt = 1; attempt <= 5; attempt++) {
      await runEmailJobs(now, badMailer)
      const j = await prisma.emailJob.findFirstOrThrow()
      expect(j.attempts).toBe(attempt)
      expect(j.lastError).not.toContain('secret')
      if (attempt < 5) {
        expect(j.status).toBe('PENDING')
        now = new Date(j.nextAttemptAt.getTime() + 1000)
      } else {
        expect(j.status).toBe('FAILED')
      }
    }
  })

  it('sends each job once even when two runs overlap', async () => {
    await queueEmail(prisma, { type: 'TEST', to: 'admin@kenha.test' })
    let count = 0
    const slow: Mailer = { send: async () => { count += 1; await new Promise((r) => setTimeout(r, 200)) } }
    await Promise.all([runEmailJobs(new Date(), slow), runEmailJobs(new Date(), slow)])
    expect(count).toBe(1)
  })

  it('queues overdue emails once, only for deadlines in the last 24 hours', async () => {
    // previous: ended 2h ago (overdue); older: ended 14h ago (overdue, within 24h); current: still running.
    const n1 = await queueOverdueReports(new Date())
    const n2 = await queueOverdueReports(new Date())
    expect(n2).toBe(0)
    const jobs = await prisma.emailJob.findMany({ orderBy: [{ shiftId: 'asc' }, { type: 'asc' }] })
    expect(n1).toBe(jobs.length)
    expect(new Set(jobs.map((j) => j.shiftId))).toEqual(new Set([world.previous.id, world.older.id]))
    expect(jobs.filter((j) => j.type === 'REPORT_OVERDUE_DD').map((j) => j.to)).toEqual(['dd@kenha.test', 'dd@kenha.test'])
    expect(jobs.filter((j) => j.type === 'REPORT_OVERDUE_SUPERVISOR')).toHaveLength(2)
    // 32 hours later both deadlines are older than 24h: nothing new even after the dedupe rows are cleared
    await prisma.emailJob.deleteMany()
    expect(await queueOverdueReports(new Date(Date.now() + 32 * 3_600_000))).toBe(0)
  })

  it('lets the admin see status, send a test email and retry a failed job', async () => {
    const admin = await loginAs(app, 'ADMIN', { email: 'admin@kenha.test' })
    const status = await call(app, 'GET', '/api/admin/email/status', { cookie: admin.cookie })
    expect(await status.json()).toEqual({ configured: false, host: null, from: null })
    expect((await call(app, 'POST', '/api/admin/email/test', { cookie: admin.cookie })).status).toBe(202)
    const job = await prisma.emailJob.findFirstOrThrow({ where: { type: 'TEST' } })
    expect(job.to).toBe('admin@kenha.test')
    await prisma.emailJob.update({ where: { id: job.id }, data: { status: 'FAILED', attempts: 5, lastError: 'boom' } })
    expect((await call(app, 'POST', `/api/admin/email-jobs/${job.id}/retry`, { cookie: admin.cookie })).status).toBe(200)
    expect(await prisma.emailJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null })
    const list = await call(app, 'GET', '/api/admin/email-jobs', { cookie: admin.cookie })
    expect(((await list.json()) as { total: number }).total).toBe(1)
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect((await call(app, 'GET', '/api/admin/email-jobs', { cookie: dd.cookie })).status).toBe(403)
  })
})
