import type { ShiftReportDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { env } from '../src/lib/env'
import { prisma } from '../src/lib/prisma'
import { markSubmitted, submitShiftReport, SUBMIT_OPENS_MINUTES_BEFORE_END } from '../src/reports/service'
import type { SessionUser } from '../src/types'
import { resetDb } from './db'
import { call, login, loginAs } from './factories'
import { incidentBody, insertIncident, resetIncidentSeq, setupIncidentWorld } from './incidentFixtures'

const app = createApp()
type World = Awaited<ReturnType<typeof setupIncidentWorld>>
let world: World
let sup: string // supervisor of world.current, officer of world.previous
let off: string // officer of world.current, supervisor of world.previous

beforeEach(async () => {
  await resetDb()
  resetIncidentSeq()
  world = await setupIncidentWorld()
  sup = await login(app, world.supervisor.email)
  off = await login(app, world.officer.email)
  await prisma.systemSetting.upsert({ where: { key: 'ddEmails' }, create: { key: 'ddEmails', value: JSON.stringify(['dd1@kenha.test', 'dd2@kenha.test']) }, update: { value: JSON.stringify(['dd1@kenha.test', 'dd2@kenha.test']) } })
})
afterAll(() => prisma.$disconnect())

const path = (shiftId: number) => `/api/shifts/${shiftId}/report`
async function draft(cookie: string, shiftId = world.current.id) {
  const res = await call(app, 'GET', path(shiftId), { cookie })
  expect(res.status).toBe(200)
  return (await res.json()) as ShiftReportDto
}
const ready = (updatedAt: string) => ({
  overallStatus: 'NORMAL', overview: 'Quiet shift', confirmReviewed: true, confirmEscalated: true, confirmHandedOver: true, confirmSubmitted: true, updatedAt,
})
const MIN = 60_000
const actorOf = (u: { id: number; fullName: string; email: string }): SessionUser => ({ id: u.id, fullName: u.fullName, email: u.email, role: 'OFFICER', mustChangePassword: false })
const timeIn = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: env.SR_APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
const errorOf = async (res: Response) => ((await res.json()) as { error: { message: string; fields?: Record<string, string> } }).error
/** Fills the previous shift's report (supervised by world.officer) so it can be submitted. */
async function readyPrevious() {
  const r = await draft(off, world.previous.id)
  const res = await call(app, 'PUT', path(world.previous.id), { cookie: off, body: ready(r.updatedAt) })
  expect(res.status).toBe(200)
  return (await res.json()) as ShiftReportDto
}

describe('shift report lifecycle', () => {
  it('creates a live draft with the shift incidents and edit rights for the supervisor only', async () => {
    await insertIncident(world, { occurredAt: new Date(Date.now() - 30 * 60_000).toISOString(), severity: 'HIGH', escalationResult: 'NOT_ESCALATED' })
    const r = await draft(sup)
    expect(r).toMatchObject({ status: 'DRAFT', canEdit: true, canSubmit: false, overdue: false }) // ends in 6h
    expect(r.submitOpensAt).toBe(new Date(world.current.endsAt.getTime() - SUBMIT_OPENS_MINUTES_BEFORE_END * MIN).toISOString())
    expect(r.content.figures.total).toBe(1)
    expect(r.content.checks[0]!.code).toBe('NOT_ESCALATED')
    expect(await draft(off)).toMatchObject({ canEdit: false, canSubmit: false })
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect(await draft(dd.cookie)).toMatchObject({ canEdit: false })
    const other = await login(app, world.otherOfficer.email)
    expect((await call(app, 'GET', path(world.current.id), { cookie: other })).status).toBe(403)
  })

  it('saves draft fields with optimistic concurrency', async () => {
    const r = await draft(sup)
    const saved = await call(app, 'PUT', path(world.current.id), { cookie: sup, body: { overview: 'Calm so far', updatedAt: r.updatedAt } })
    expect(saved.status).toBe(200)
    const after = (await saved.json()) as ShiftReportDto
    expect(after.fields.overview).toBe('Calm so far')
    const stale = await call(app, 'PUT', path(world.current.id), { cookie: sup, body: { overview: 'x', updatedAt: r.updatedAt } })
    expect(stale.status).toBe(409)
    expect((await call(app, 'PUT', path(world.current.id), { cookie: off, body: { overview: 'x', updatedAt: after.updatedAt } })).status).toBe(403)
  })

  it('refuses to submit until the required fields are set, then freezes the report and queues one email per DD address', async () => {
    // world.previous ended 2h ago; its supervisor is world.officer (cookie `off`)
    const prev = path(world.previous.id)
    const r = await draft(off, world.previous.id)
    const bad = await call(app, 'POST', `${prev}/submit`, { cookie: off })
    expect(bad.status).toBe(400)
    expect((await errorOf(bad)).fields).toHaveProperty('overview')
    const saved = (await (await call(app, 'PUT', prev, { cookie: off, body: ready(r.updatedAt) })).json()) as ShiftReportDto
    expect(saved.canSubmit).toBe(true)
    expect((await call(app, 'POST', `${prev}/submit`, { cookie: sup })).status).toBe(403)
    const ok = await call(app, 'POST', `${prev}/submit`, { cookie: off })
    expect(ok.status).toBe(200)
    const sub = (await ok.json()) as ShiftReportDto
    expect(sub).toMatchObject({ status: 'SUBMITTED', timeliness: 'LATE', canEdit: false, canSubmit: false })
    expect(sub.lateMinutes).toBeGreaterThanOrEqual(90) // deadline was 30 min after the end
    expect(sub.submittedBy?.id).toBe(world.officer.id)
    expect((await call(app, 'POST', `${prev}/submit`, { cookie: off })).status).toBe(409)
    expect((await call(app, 'PUT', prev, { cookie: off, body: { overview: 'late edit', updatedAt: saved.updatedAt } })).status).toBe(409)
    const jobs = await prisma.emailJob.findMany({ orderBy: { to: 'asc' } })
    expect(jobs.map((j) => [j.type, j.to, j.status])).toEqual([
      ['REPORT_SUBMITTED', 'dd1@kenha.test', 'PENDING'],
      ['REPORT_SUBMITTED', 'dd2@kenha.test', 'PENDING'],
    ])
    expect(await prisma.auditLog.count({ where: { entity: 'ShiftReport', action: 'SUBMIT' } })).toBe(1)
  })

  it('opens submit 30 minutes before the shift ends', async () => {
    const r = await draft(sup)
    await call(app, 'PUT', path(world.current.id), { cookie: sup, body: ready(r.updatedAt) })
    const early = await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })
    expect(early.status).toBe(400)
    const opensAt = new Date(world.current.endsAt.getTime() - 30 * MIN)
    const message = `You can submit from ${timeIn(opensAt)}, 30 minutes before the shift ends`
    expect(await errorOf(early)).toMatchObject({ message, fields: { _: message } })
    expect(await prisma.shiftReport.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'DRAFT' })
    const actor = actorOf(world.supervisor)
    await expect(submitShiftReport(actor, world.current.id, null, new Date(opensAt.getTime() - MIN))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message })
    expect(await submitShiftReport(actor, world.current.id, null, opensAt)).toMatchObject({ status: 'SUBMITTED', timeliness: 'ON_TIME' })
  })

  it('treats a shift that has not started as not found and creates no draft', async () => {
    const def = await prisma.shiftDefinition.findUniqueOrThrow({ where: { code: 'NIGHT' } })
    const future = await prisma.shift.create({
      data: {
        shiftDate: world.current.shiftDate, shiftDefinitionId: def.id, startsAt: world.current.endsAt, endsAt: new Date(world.current.endsAt.getTime() + 12 * 60 * MIN),
        supervisorId: world.supervisor.id, officerId: world.officer.id,
      },
    })
    const responses = [
      await call(app, 'GET', path(future.id), { cookie: sup }),
      await call(app, 'PUT', path(future.id), { cookie: sup, body: { overview: 'x', updatedAt: new Date().toISOString() } }),
      await call(app, 'POST', `${path(future.id)}/submit`, { cookie: sup }),
    ]
    for (const res of responses) {
      expect(res.status).toBe(404)
      expect((await errorOf(res)).message).toBe('This shift has not started yet')
    }
    expect(await prisma.shiftReport.count({ where: { shiftId: future.id } })).toBe(0)
  })

  it('refuses to submit a draft that was saved after the submit read it', async () => {
    const r = await readyPrevious()
    const stale = { id: r.id, updatedAt: new Date(r.updatedAt) }
    // a PUT lands between the submit's read and its commit
    expect((await call(app, 'PUT', path(world.previous.id), { cookie: off, body: { overview: 'Changed meanwhile', updatedAt: r.updatedAt } })).status).toBe(200)
    await expect(markSubmitted(prisma, stale, { status: 'SUBMITTED' })).rejects.toMatchObject({
      code: 'CONFLICT', message: 'This report was updated elsewhere. Reload the draft and submit again.',
    })
    expect(await prisma.shiftReport.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: 'DRAFT' })
    expect((await call(app, 'POST', `${path(world.previous.id)}/submit`, { cookie: off })).status).toBe(200)
    await expect(markSubmitted(prisma, stale, { status: 'SUBMITTED' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'This report has already been submitted' })
  })

  it('records a skipped job when no DD address is configured', async () => {
    await prisma.systemSetting.update({ where: { key: 'ddEmails' }, data: { value: '[]' } })
    await readyPrevious()
    expect((await call(app, 'POST', `${path(world.previous.id)}/submit`, { cookie: off })).status).toBe(200)
    const jobs = await prisma.emailJob.findMany()
    expect(jobs.map((j) => [j.to, j.status])).toEqual([['', 'SKIPPED_NO_RECIPIENT']])
  })

  it('keeps the submitted snapshot frozen after an admin edits an incident, and locks the shift for officers', async () => {
    const occurredAt = new Date(Date.now() - 5 * 60 * MIN).toISOString() // inside world.previous
    const i = await insertIncident(world, { occurredAt, severity: 'LOW', description: 'Before', shiftId: world.previous.id, shiftCode: 'NIGHT' })
    await readyPrevious()
    expect((await call(app, 'POST', `${path(world.previous.id)}/submit`, { cookie: off })).status).toBe(200)
    const admin = await loginAs(app, 'ADMIN')
    const patched = await call(app, 'PATCH', `/api/incidents/${i.id}`, { cookie: admin.cookie, body: incidentBody(world, { occurredAt, severity: 'CRITICAL', description: 'After' }) })
    expect(patched.status).toBe(200)
    const again = await draft(off, world.previous.id)
    expect(again.content.figures.bySeverity.CRITICAL).toBe(0)
    expect(again.content.incidents[0]!.severity).toBe('LOW')
    const refused = [
      await call(app, 'PATCH', `/api/incidents/${i.id}`, { cookie: off, body: incidentBody(world, { occurredAt, description: 'Officer edit' }) }),
      await call(app, 'POST', '/api/incidents', { cookie: off, body: incidentBody(world, { occurredAt }) }),
    ]
    for (const res of refused) {
      expect(res.status).toBe(403)
      expect((await errorOf(res)).message).toBe("This shift's report has been submitted; incidents can no longer be changed.")
    }
  })

  it('returns 404 for a shift with no roster entry and lists reports for the DD with derived overdue', async () => {
    expect((await call(app, 'GET', path(999999), { cookie: sup })).status).toBe(404)
    await draft(sup, world.previous.id) // previous ended 2h ago → overdue with the 30 min default
    await draft(sup)
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    const list = await call(app, 'GET', '/api/reports?status=OVERDUE', { cookie: dd.cookie })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { items: { shiftId: number; overdue: boolean }[]; total: number }
    expect(body.items.map((x) => x.shiftId)).toEqual([world.previous.id])
    expect(body.items[0]!.overdue).toBe(true)
    expect((await call(app, 'GET', '/api/reports', { cookie: sup })).status).toBe(403)
    const byId = await call(app, 'GET', `/api/reports/${(await draft(sup)).id}`, { cookie: off })
    expect(byId.status).toBe(200)
  })
  it('downloads a draft PDF and the stored PDF after submit, for people who can read the report', async () => {
    const r = await draft(sup)
    const d = await call(app, 'GET', `/api/reports/${r.id}/pdf`, { cookie: off })
    expect(d.status).toBe(200)
    expect(d.headers.get('content-type')).toBe('application/pdf')
    expect(d.headers.get('content-disposition')).toMatch(/^attachment; filename="Shift-report-\d{4}-\d{2}-\d{2}-DAY\.pdf"$/)
    const p = await readyPrevious()
    expect((await call(app, 'POST', `${path(world.previous.id)}/submit`, { cookie: off })).status).toBe(200)
    const s = await call(app, 'GET', `/api/reports/${p.id}/pdf`, { cookie: sup })
    expect(s.status).toBe(200)
    expect(s.headers.get('content-disposition')).toMatch(/-NIGHT\.pdf"$/)
    expect(Buffer.from(await s.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await prisma.shiftReport.findUniqueOrThrow({ where: { id: p.id } })).pdfStoredName).toMatch(/\.pdf$/)
    const other = await login(app, world.otherOfficer.email)
    expect((await call(app, 'GET', `/api/reports/${r.id}/pdf`, { cookie: other })).status).toBe(403)
  })
})
