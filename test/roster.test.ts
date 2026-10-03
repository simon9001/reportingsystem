import type { CopyWeekResult, MeResponse, ShiftDefinitionDto, ShiftDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { seedDefaults } from '../src/config/seedDefaults'
import { env } from '../src/lib/env'
import { prisma } from '../src/lib/prisma'
import { resolveShift } from '../src/lib/shiftTime'
import { resetDb } from './db'
import { call, createUser, login, loginAs } from './factories'

const app = createApp()
const FUTURE_MONDAY = '2030-01-07'

async function setup() {
  const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
  const antony = await createUser('OFFICER', { fullName: 'Antony Ochieng' })
  const simon = await createUser('OFFICER', { fullName: 'Simon Gatungo' })
  return { dd, antony, simon }
}

describe('roster', () => {
  beforeEach(async () => {
    await resetDb()
    await seedDefaults(prisma)
  })
  afterAll(() => prisma.$disconnect())

  it('creates Day and Night shifts with Nairobi windows', async () => {
    const { dd, antony, simon } = await setup()
    const res = await call(app, 'PUT', '/api/roster', {
      cookie: dd.cookie,
      body: { entries: [
        { shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id },
        { shiftDate: FUTURE_MONDAY, shiftCode: 'NIGHT', supervisorId: simon.id, officerId: antony.id },
      ] },
    })
    expect(res.status).toBe(200)
    const [day, night] = (await res.json()) as ShiftDto[]
    expect(day).toMatchObject({ shiftCode: 'DAY', startsAt: '2030-01-07T05:00:00.000Z', endsAt: '2030-01-07T14:00:00.000Z', supervisor: { fullName: 'Antony Ochieng' } })
    expect(night).toMatchObject({ shiftCode: 'NIGHT', startsAt: '2030-01-07T14:00:00.000Z', endsAt: '2030-01-08T05:00:00.000Z' })
    expect(await prisma.auditLog.count({ where: { entity: 'Shift', action: 'CREATE' } })).toBe(2)
  })

  it('rejects the same person twice, non-officers, inactive officers and unknown shifts', async () => {
    const { dd, antony, simon } = await setup()
    const inactive = await createUser('OFFICER', { isActive: false })
    const put = (e: object) => call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', ...e }] } })
    expect((await put({ supervisorId: antony.id, officerId: antony.id })).status).toBe(400)
    expect((await put({ supervisorId: dd.user.id, officerId: simon.id })).status).toBe(400)
    expect((await put({ supervisorId: inactive.id, officerId: simon.id })).status).toBe(400)
    expect((await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ shiftDate: FUTURE_MONDAY, shiftCode: 'EVENING', supervisorId: antony.id, officerId: simon.id }] } })).status).toBe(400)
    expect(await prisma.shift.count()).toBe(0)
  })

  it('rejects the same date and shift twice in one save without saving anything', async () => {
    const { dd, antony, simon } = await setup()
    const e = { shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }
    const res = await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [e, { ...e, supervisorId: simon.id, officerId: antony.id }] } })
    expect(res.status).toBe(400)
    expect(await prisma.shift.count()).toBe(0)
  })

  it('updates people on an existing shift and audits it', async () => {
    const { dd, antony, simon } = await setup()
    const e = { shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }
    await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [e] } })
    const res = await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ ...e, supervisorId: simon.id, officerId: antony.id }] } })
    expect(((await res.json()) as ShiftDto[])[0]!.supervisor.id).toBe(simon.id)
    expect(await prisma.shift.count()).toBe(1)
    expect(await prisma.auditLog.count({ where: { entity: 'Shift', action: 'UPDATE' } })).toBe(1)
  })

  it('keeps existing shift windows when shift times change later', async () => {
    const { dd, antony, simon } = await setup()
    await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }] } })
    const admin = await loginAs(app, 'ADMIN')
    const defs = (await (await call(app, 'GET', '/api/config/shift-definitions', { cookie: admin.cookie })).json()) as ShiftDefinitionDto[]
    await call(app, 'PUT', '/api/config/shift-definitions', { cookie: admin.cookie, body: [
      { id: defs[0]!.id, name: 'Day', startTime: '07:00', endTime: '16:00' },
      { id: defs[1]!.id, name: 'Night', startTime: '16:00', endTime: '07:00' },
    ] })
    await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ shiftDate: '2030-01-08', shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }] } })
    const list = (await (await call(app, 'GET', `/api/roster?from=${FUTURE_MONDAY}&to=2030-01-08`, { cookie: dd.cookie })).json()) as ShiftDto[]
    expect(list.map((s) => s.startsAt)).toEqual(['2030-01-07T05:00:00.000Z', '2030-01-08T04:00:00.000Z'])
  })

  it('lets officers read the roster but not change it, and validates the range', async () => {
    const officer = await loginAs(app, 'OFFICER')
    expect((await call(app, 'GET', `/api/roster?from=${FUTURE_MONDAY}&to=2030-01-20`, { cookie: officer.cookie })).status).toBe(200)
    expect((await call(app, 'GET', `/api/roster?from=2030-01-20&to=${FUTURE_MONDAY}`, { cookie: officer.cookie })).status).toBe(400)
    expect((await call(app, 'GET', '/api/roster?from=2030-01-01&to=2030-12-31', { cookie: officer.cookie })).status).toBe(400)
    expect((await call(app, 'PUT', '/api/roster', { cookie: officer.cookie, body: { entries: [] } })).status).toBe(403)
  })

  it('protects shifts that have ended: only admins may create or change them', async () => {
    const { dd, antony, simon } = await setup()
    const past = { shiftDate: '2020-01-01', shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }
    expect((await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [past] } })).status).toBe(409)
    const admin = await loginAs(app, 'ADMIN')
    expect((await call(app, 'PUT', '/api/roster', { cookie: admin.cookie, body: { entries: [past] } })).status).toBe(200)
    expect((await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ ...past, supervisorId: simon.id, officerId: antony.id }] } })).status).toBe(409)
  })

  it('deletes future shifts but not started ones', async () => {
    const { dd, antony, simon } = await setup()
    const [future] = (await (await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }] } })).json()) as ShiftDto[]
    expect((await call(app, 'DELETE', `/api/roster/${future!.id}`, { cookie: dd.cookie })).status).toBe(204)
    const admin = await loginAs(app, 'ADMIN')
    const [past] = (await (await call(app, 'PUT', '/api/roster', { cookie: admin.cookie, body: { entries: [{ shiftDate: '2020-01-01', shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id }] } })).json()) as ShiftDto[]
    expect((await call(app, 'DELETE', `/api/roster/${past!.id}`, { cookie: admin.cookie })).status).toBe(409)
  })

  it('copies a week, swapping roles, skipping existing shifts and deactivated officers', async () => {
    const { dd, antony, simon } = await setup()
    const peter = await createUser('OFFICER', { fullName: 'Peter Kamau' })
    await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [
      { shiftDate: FUTURE_MONDAY, shiftCode: 'DAY', supervisorId: antony.id, officerId: simon.id },
      { shiftDate: '2030-01-08', shiftCode: 'NIGHT', supervisorId: peter.id, officerId: simon.id },
    ] } })
    await prisma.user.update({ where: { id: peter.id }, data: { isActive: false } })

    const res = await call(app, 'POST', '/api/roster/copy-week', { cookie: dd.cookie, body: { fromWeekStart: FUTURE_MONDAY, toWeekStart: '2030-01-14', swapRoles: true } })
    expect((await res.json()) as CopyWeekResult).toEqual({ created: 1, skipped: 1 })
    const copied = (await (await call(app, 'GET', '/api/roster?from=2030-01-14&to=2030-01-20', { cookie: dd.cookie })).json()) as ShiftDto[]
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({ shiftDate: '2030-01-14', shiftCode: 'DAY', supervisor: { id: simon.id }, officer: { id: antony.id } })

    const again = await call(app, 'POST', '/api/roster/copy-week', { cookie: dd.cookie, body: { fromWeekStart: FUTURE_MONDAY, toWeekStart: '2030-01-14', swapRoles: true } })
    expect((await again.json()) as CopyWeekResult).toEqual({ created: 0, skipped: 2 })
  })

  it('tells each user the current shift and their role on it', async () => {
    const { dd, antony, simon } = await setup()
    const defs = await prisma.shiftDefinition.findMany()
    const now = resolveShift(new Date(), defs, env.SR_APP_TIMEZONE)!

    const before = (await (await call(app, 'GET', '/api/auth/me', { cookie: dd.cookie })).json()) as MeResponse
    expect(before.currentShift).toMatchObject({ shiftDate: now.shiftDate, shiftCode: now.definition.code, shift: null, myRole: null })

    const admin = await loginAs(app, 'ADMIN')
    await call(app, 'PUT', '/api/roster', { cookie: admin.cookie, body: { entries: [{ shiftDate: now.shiftDate, shiftCode: now.definition.code, supervisorId: antony.id, officerId: simon.id }] } })

    const asAntony = (await (await call(app, 'GET', '/api/auth/me', { cookie: await login(app, antony.email) })).json()) as MeResponse
    const asSimon = (await (await call(app, 'GET', '/api/roster/current', { cookie: await login(app, simon.email) })).json()) as MeResponse['currentShift']
    const asDd = (await (await call(app, 'GET', '/api/auth/me', { cookie: dd.cookie })).json()) as MeResponse
    expect(asAntony.currentShift?.myRole).toBe('SUPERVISOR')
    expect(asSimon?.myRole).toBe('OFFICER')
    expect(asDd.currentShift?.shift?.supervisor.fullName).toBe('Antony Ochieng')
    expect(asDd.currentShift?.myRole).toBeNull()
  })
})
