import type { ShiftReportDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, login, loginAs } from './factories'
import { incidentBody, insertIncident, resetIncidentSeq, setupIncidentWorld } from './incidentFixtures'

const app = createApp()
type World = Awaited<ReturnType<typeof setupIncidentWorld>>
let world: World
let sup: string // supervisor of world.current
let off: string // officer of world.current

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

describe('shift report lifecycle', () => {
  it('creates a live draft with the shift incidents and edit rights for the supervisor only', async () => {
    await insertIncident(world, { occurredAt: new Date(Date.now() - 30 * 60_000).toISOString(), severity: 'HIGH', escalationResult: 'NOT_ESCALATED' })
    const r = await draft(sup)
    expect(r).toMatchObject({ status: 'DRAFT', canEdit: true, canSubmit: true, overdue: false })
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
    const r = await draft(sup)
    const bad = await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { fields: Record<string, string> } }).error.fields).toHaveProperty('overview')
    const saved = (await (await call(app, 'PUT', path(world.current.id), { cookie: sup, body: ready(r.updatedAt) })).json()) as ShiftReportDto
    expect((await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: off })).status).toBe(403)
    const ok = await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })
    expect(ok.status).toBe(200)
    const sub = (await ok.json()) as ShiftReportDto
    expect(sub).toMatchObject({ status: 'SUBMITTED', timeliness: 'ON_TIME', canEdit: false, canSubmit: false })
    expect(sub.submittedBy?.id).toBe(world.supervisor.id)
    expect((await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })).status).toBe(409)
    expect((await call(app, 'PUT', path(world.current.id), { cookie: sup, body: { overview: 'late edit', updatedAt: saved.updatedAt } })).status).toBe(409)
    const jobs = await prisma.emailJob.findMany({ orderBy: { to: 'asc' } })
    expect(jobs.map((j) => [j.type, j.to, j.status])).toEqual([
      ['REPORT_SUBMITTED', 'dd1@kenha.test', 'PENDING'],
      ['REPORT_SUBMITTED', 'dd2@kenha.test', 'PENDING'],
    ])
    expect(await prisma.auditLog.count({ where: { entity: 'ShiftReport', action: 'SUBMIT' } })).toBe(1)
  })

  it('records a skipped job when no DD address is configured', async () => {
    await prisma.systemSetting.update({ where: { key: 'ddEmails' }, data: { value: '[]' } })
    const r = await draft(sup)
    await call(app, 'PUT', path(world.current.id), { cookie: sup, body: ready(r.updatedAt) })
    await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })
    const jobs = await prisma.emailJob.findMany()
    expect(jobs.map((j) => [j.to, j.status])).toEqual([['', 'SKIPPED_NO_RECIPIENT']])
  })

  it('keeps the submitted snapshot frozen after an admin edits an incident, and locks the shift for officers', async () => {
    const i = await insertIncident(world, { occurredAt: new Date(Date.now() - 30 * 60_000).toISOString(), severity: 'LOW', description: 'Before' })
    const r = await draft(sup)
    await call(app, 'PUT', path(world.current.id), { cookie: sup, body: ready(r.updatedAt) })
    await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })
    const admin = await loginAs(app, 'ADMIN')
    const patched = await call(app, 'PATCH', `/api/incidents/${i.id}`, { cookie: admin.cookie, body: incidentBody(world, { severity: 'CRITICAL', description: 'After' }) })
    expect(patched.status).toBe(200)
    const again = await draft(sup)
    expect(again.content.figures.bySeverity.CRITICAL).toBe(0)
    expect(again.content.incidents[0]!.severity).toBe('LOW')
    expect((await call(app, 'PATCH', `/api/incidents/${i.id}`, { cookie: sup, body: incidentBody(world, { description: 'Officer edit' }) })).status).toBe(403)
    expect((await call(app, 'POST', '/api/incidents', { cookie: sup, body: incidentBody(world) })).status).toBe(403)
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
    await call(app, 'PUT', path(world.current.id), { cookie: sup, body: ready(r.updatedAt) })
    await call(app, 'POST', `${path(world.current.id)}/submit`, { cookie: sup })
    const s = await call(app, 'GET', `/api/reports/${r.id}/pdf`, { cookie: sup })
    expect(s.status).toBe(200)
    expect(Buffer.from(await s.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await prisma.shiftReport.findUniqueOrThrow({ where: { id: r.id } })).pdfStoredName).toMatch(/\.pdf$/)
    const other = await login(app, world.otherOfficer.email)
    expect((await call(app, 'GET', `/api/reports/${r.id}/pdf`, { cookie: other })).status).toBe(403)
  })
})
