import type { IncidentDto, MeResponse } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, login, loginAs } from './factories'
import { incidentBody, insertIncident, mobileBody, setupIncidentWorld } from './incidentFixtures'

const app = createApp()
const HOUR = 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('incident register', () => {
  let world: Awaited<ReturnType<typeof setupIncidentWorld>>
  let supCookie: string

  beforeEach(async () => {
    await resetDb()
    world = await setupIncidentWorld()
    supCookie = await login(app, world.supervisor.email)
  })
  afterAll(() => prisma.$disconnect())

  it('lets the on-shift officer log an incident with ref, shift, escalation result and timeline', async () => {
    const occurredAt = ago(30 * 60_000)
    const res = await call(app, 'POST', '/api/incidents', {
      cookie: supCookie,
      body: incidentBody(world, { occurredAt, escalatedTo: 'ICT Officer', escalatedAt: new Date(Date.parse(occurredAt) + 15 * 60_000).toISOString() }),
    })
    expect(res.status).toBe(201)
    const dto = (await res.json()) as IncidentDto
    expect(dto.ref).toMatch(/^INC-\d{4}-0001$/)
    expect(dto.shiftId).toBe(world.current.id)
    expect(dto.reportedBy.fullName).toBe('Antony Ochieng')
    expect(dto.escalationResult).toBe('ON_TIME')
    expect(dto.escalationMinutes).toBe(15)
    expect(dto.canEdit).toBe(true)
    expect(dto.events.map((e) => e.kind)).toEqual(['CREATED', 'ESCALATED'])
    expect(await prisma.auditLog.count({ where: { entity: 'Incident', action: 'CREATE' } })).toBe(1)
  })

  it('attaches late entries to the previous shift but refuses older shifts', async () => {
    const late = await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { occurredAt: ago(5 * HOUR) }) })
    expect(late.status).toBe(201)
    expect(((await late.json()) as IncidentDto).shiftId).toBe(world.previous.id)
    const old = await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { occurredAt: ago(20 * HOUR) }) })
    expect(old.status).toBe(403)
  })

  it('explains when nobody was rostered at that time', async () => {
    const res = await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { occurredAt: ago(40 * HOUR) }) })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; fields: Record<string, string> } }
    expect(body.error.code).toBe('NO_ROSTER')
    expect(body.error.fields.occurredAt).toMatch(/No roster/)
  })

  it('rejects future times, inactive categories and invalid status combinations', async () => {
    const future = await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { occurredAt: new Date(Date.now() + HOUR).toISOString() }) })
    expect(future.status).toBe(400)
    const inactive = await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { categoryId: world.inactiveCategory.id }) })
    expect(inactive.status).toBe(400)
    const unresolved = await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { status: 'RESOLVED' }) })
    expect(unresolved.status).toBe(400)
  })

  it('is read-only for the Deputy Director and officers not on the shift', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect((await call(app, 'POST', '/api/incidents', { cookie: dd.cookie, body: incidentBody(world) })).status).toBe(403)
    const other = await login(app, world.otherOfficer.email)
    expect((await call(app, 'POST', '/api/incidents', { cookie: other, body: incidentBody(world) })).status).toBe(403)
  })

  it('never gives two concurrent incidents the same number', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world) })),
    )
    const refs = await Promise.all(results.map(async (r) => ((await r.json()) as IncidentDto).ref))
    expect(results.every((r) => r.status === 201)).toBe(true)
    expect(new Set(refs).size).toBe(5)
  })

  it('updates an incident, computes resolution time and records the timeline', async () => {
    const occurredAt = ago(60 * 60_000)
    const created = (await (await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world, { occurredAt }) })).json()) as IncidentDto
    const res = await call(app, 'PATCH', `/api/incidents/${created.id}`, {
      cookie: supCookie,
      body: incidentBody(world, { occurredAt, severity: 'CRITICAL', status: 'RESOLVED', resolvedAt: new Date(Date.parse(occurredAt) + 55 * 60_000).toISOString(), resolution: 'Restored' }),
    })
    expect(res.status).toBe(200)
    const dto = (await res.json()) as IncidentDto
    expect(dto.minutesToResolve).toBe(55)
    expect(dto.events.map((e) => e.summary)).toEqual(['Logged by Antony Ochieng', 'Resolved: Restored', 'Updated severity'])
  })

  it('reads by id or ref; canEdit reflects the viewer', async () => {
    const created = (await (await call(app, 'POST', '/api/incidents', { cookie: supCookie, body: incidentBody(world) })).json()) as IncidentDto
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    const byRef = (await (await call(app, 'GET', `/api/incidents/${created.ref.toLowerCase()}`, { cookie: dd.cookie })).json()) as IncidentDto
    expect(byRef.id).toBe(created.id)
    expect(byRef.canEdit).toBe(false)
    expect((await call(app, 'GET', '/api/incidents/INC-1999-0001', { cookie: dd.cookie })).status).toBe(404)
  })

  it('lets an administrator log and edit on any shift', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const res = await call(app, 'POST', '/api/incidents', { cookie: admin.cookie, body: incidentBody(world, { occurredAt: ago(20 * HOUR) }) })
    expect(res.status).toBe(201)
    expect(((await res.json()) as IncidentDto).shiftId).toBe(world.older.id)
  })

  describe('late entries in the session payload', () => {
    const me = async (cookie: string) => (await (await call(app, 'GET', '/api/auth/me', { cookie })).json()) as MeResponse

    it('reports the previous shift the officer is rostered on and can still edit', async () => {
      const body = await me(supCookie)
      expect(body.previousShift).toMatchObject({ id: world.previous.id, shiftCode: 'NIGHT', myRole: 'OFFICER', endsAt: world.previous.endsAt.toISOString() })
      expect(body.previousShift?.shiftName).toBeTruthy()
    })

    it('is null for officers not on the previous shift and for read-only or admin roles', async () => {
      expect((await me(await login(app, world.otherOfficer.email))).previousShift).toBeNull()
      expect((await me((await loginAs(app, 'DEPUTY_DIRECTOR')).cookie)).previousShift).toBeNull()
      expect((await me((await loginAs(app, 'ADMIN')).cookie)).previousShift).toBeNull()
    })

    it('lets an officer rostered only on the previous shift see it and log a late entry there', async () => {
      await prisma.shift.update({ where: { id: world.previous.id }, data: { supervisorId: world.otherOfficer.id } })
      const cookie = await login(app, world.otherOfficer.email)
      const body = await me(cookie)
      expect(body.currentShift?.myRole).toBeNull()
      expect(body.previousShift).toMatchObject({ id: world.previous.id, myRole: 'SUPERVISOR' })
      const res = await call(app, 'POST', '/api/incidents', { cookie, body: incidentBody(world, { occurredAt: ago(5 * HOUR) }) })
      expect(res.status).toBe(201)
    })
  })

  describe('edit permissions', () => {
    const patch = (cookie: string, id: number, overrides: Record<string, unknown> = {}) =>
      call(app, 'PATCH', `/api/incidents/${id}`, { cookie, body: incidentBody(world, overrides) })
    const create = async (cookie: string, overrides: Record<string, unknown> = {}) =>
      (await (await call(app, 'POST', '/api/incidents', { cookie, body: incidentBody(world, overrides) })).json()) as IncidentDto

    it('refuses PATCH from an officer not on the shift and from the Deputy Director', async () => {
      const created = await create(supCookie)
      expect((await patch(await login(app, world.otherOfficer.email), created.id)).status).toBe(403)
      const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
      expect((await patch(dd.cookie, created.id)).status).toBe(403)
    })

    it('refuses PATCH on older shifts for the supervisor, allows it for an admin', async () => {
      const admin = await loginAs(app, 'ADMIN')
      const old = await create(admin.cookie, { occurredAt: ago(20 * HOUR) })
      expect((await patch(supCookie, old.id, { occurredAt: old.occurredAt })).status).toBe(403)
      const res = await patch(admin.cookie, old.id, { occurredAt: old.occurredAt, severity: 'LOW' })
      expect(res.status).toBe(200)
    })

    it('refuses moving an incident into an older shift', async () => {
      const created = await create(supCookie)
      expect((await patch(supCookie, created.id, { occurredAt: ago(20 * HOUR) })).status).toBe(403)
    })

    it('shows canEdit on the previous shift for its rostered supervisor', async () => {
      const prev = await create(supCookie, { occurredAt: ago(5 * HOUR) })
      const got = (await (await call(app, 'GET', `/api/incidents/${prev.id}`, { cookie: supCookie })).json()) as IncidentDto
      expect(got.canEdit).toBe(true)
    })

    it('gates read-only roles before validation and bounds ids', async () => {
      const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
      const res = await call(app, 'POST', '/api/incidents', { cookie: dd.cookie, body: incidentBody(world, { occurredAt: new Date(Date.now() + HOUR).toISOString() }) })
      expect(res.status).toBe(403)
      expect((await call(app, 'GET', '/api/incidents/99999999999', { cookie: dd.cookie })).status).toBe(404)
    })
  })

  it('returns mobile weighbridge fields and marks older rows as static', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    const stat = await insertIncident(world, { occurredAt: ago(HOUR) })
    const mob = await insertIncident(world, {
      occurredAt: ago(HOUR), side: 'MOBILE', vehicleUnitId: 'KDG 143S', platformValue: 'Tracksolid', locationValue: null, locationText: 'Mlolongo',
      vehicleStatus: 'ONLINE', gpsStatus: 'ONLINE', dashcamStatus: 'OFFLINE', remarks: 'CH3 shows rainbow colours',
    })
    const s = (await (await call(app, 'GET', `/api/incidents/${stat.id}`, { cookie: dd.cookie })).json()) as IncidentDto
    expect(s).toMatchObject({ side: 'STATIC', vehicle: null, platform: null, locationText: null })
    expect(s.location?.value).toBe('Weighbridge 04')
    const m = (await (await call(app, 'GET', `/api/incidents/${mob.id}`, { cookie: dd.cookie })).json()) as IncidentDto
    expect(m).toMatchObject({
      side: 'MOBILE', location: null, locationText: 'Mlolongo', vehicleStatus: 'ONLINE', gpsStatus: 'ONLINE', dashcamStatus: 'OFFLINE',
      remarks: 'CH3 shows rainbow colours',
    })
    expect(m.vehicle?.unitId).toBe('KDG 143S')
    expect(m.platform?.value).toBe('Tracksolid')
    expect(m.ref).toMatch(/^MWB-/)
  })
})

describe('mobile weighbridge incidents', () => {
  let world: Awaited<ReturnType<typeof setupIncidentWorld>>
  let supCookie: string
  const post = (body: unknown, cookie = supCookie) => call(app, 'POST', '/api/incidents', { cookie, body })
  const fieldsOf = async (res: Response) => ((await res.json()) as { error: { fields?: Record<string, string> } }).error.fields ?? {}

  beforeEach(async () => {
    await resetDb()
    world = await setupIncidentWorld()
    supCookie = await login(app, world.supervisor.email)
  })

  it('logs a mobile incident with its own MWB number, leaving static numbering alone', async () => {
    const stat = (await (await post(incidentBody(world))).json()) as IncidentDto
    const res = await post(mobileBody(world))
    expect(res.status).toBe(201)
    const dto = (await res.json()) as IncidentDto
    expect(stat.ref).toMatch(/^INC-\d{4}-0001$/)
    expect(dto.ref).toMatch(/^MWB-\d{4}-0001$/)
    expect(dto).toMatchObject({
      side: 'MOBILE', locationText: 'Mlolongo', location: null, vehicleStatus: 'ONLINE', gpsStatus: 'ONLINE', dashcamStatus: 'OFFLINE',
      remarks: 'CH3 camera is showing rainbow colours', immediateAction: 'Notified fleet manager', locationDetail: null,
    })
    expect(dto.vehicle?.unitId).toBe('KDG 143S')
    expect(dto.platform?.value).toBe('Tracksolid')
    expect(dto.events.map((e) => e.kind)).toEqual(['CREATED'])
  })

  it('accepts a listed place instead of a typed one', async () => {
    const res = await post(mobileBody(world, { locationText: null, locationId: world.location.id }))
    expect(res.status).toBe(201)
    expect(((await res.json()) as IncidentDto).location?.id).toBe(world.location.id)
  })

  it('refuses inactive vehicles for new incidents and platforms that are not platforms', async () => {
    const inactive = await post(mobileBody(world, { vehicleId: world.inactiveVehicle.id }))
    expect(inactive.status).toBe(400)
    expect((await fieldsOf(inactive)).vehicleId).toBe('Choose a valid vehicle / unit')
    const wrongList = await post(mobileBody(world, { platformId: world.category.id }))
    expect(wrongList.status).toBe(400)
    expect((await fieldsOf(wrongList)).platformId).toBe('Choose a valid platform')
  })

  it('still saves edits to an incident whose vehicle was deactivated later', async () => {
    const created = (await (await post(mobileBody(world))).json()) as IncidentDto
    await prisma.vehicle.update({ where: { id: world.vehicle.id }, data: { isActive: false } })
    const res = await call(app, 'PATCH', `/api/incidents/${created.id}`, { cookie: supCookie, body: mobileBody(world, { occurredAt: created.occurredAt, status: 'MONITORING' }) })
    expect(res.status).toBe(200)
  })

  it('never lets an edit change the side', async () => {
    const created = (await (await post(mobileBody(world))).json()) as IncidentDto
    const flipped = await call(app, 'PATCH', `/api/incidents/${created.id}`, { cookie: supCookie, body: incidentBody(world, { occurredAt: created.occurredAt }) })
    expect(flipped.status).toBe(400)
    expect((await fieldsOf(flipped)).side).toBe('The side cannot be changed')
  })

  it('records mobile field changes in the timeline', async () => {
    const created = (await (await post(mobileBody(world))).json()) as IncidentDto
    const res = await call(app, 'PATCH', `/api/incidents/${created.id}`, {
      cookie: supCookie, body: mobileBody(world, { occurredAt: created.occurredAt, gpsStatus: 'OFFLINE', remarks: 'GPS lost near Athi River' }),
    })
    const dto = (await res.json()) as IncidentDto
    expect(dto.events.at(-1)?.summary).toBe('Updated GPS status, remarks')
  })

  it('keeps the same permissions as static incidents', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect((await post(mobileBody(world), dd.cookie)).status).toBe(403)
    const other = await login(app, world.otherOfficer.email)
    expect((await post(mobileBody(world), other)).status).toBe(403)
  })
})
