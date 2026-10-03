import type { ShiftDto, UpdateUserResult, UserDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, createUser, login, loginAs } from './factories'

const app = createApp()
const newUser = { fullName: 'Simon Gatungo', email: 'Simon.Gatungo@KeNHA.go.ke', role: 'OFFICER', password: 'TempPassword1' }

describe('users', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('lets an admin create a user who must change their password', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    const res = await call(app, 'POST', '/api/users', { cookie, body: newUser })
    expect(res.status).toBe(201)
    const body = (await res.json()) as UserDto & { passwordHash?: string }
    expect(body).toMatchObject({ fullName: 'Simon Gatungo', email: 'simon.gatungo@kenha.go.ke', role: 'OFFICER', isActive: true, mustChangePassword: true })
    expect(body.passwordHash).toBeUndefined()
    expect(await prisma.auditLog.count({ where: { entity: 'User', action: 'CREATE' } })).toBe(1)
    await expect(login(app, 'SIMON.GATUNGO@kenha.go.ke', 'TempPassword1')).resolves.toMatch(/^sr_session=/)
  })

  it('rejects a duplicate email with a field error', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    await call(app, 'POST', '/api/users', { cookie, body: newUser })
    const res = await call(app, 'POST', '/api/users', { cookie, body: { ...newUser, email: 'simon.gatungo@kenha.go.ke' } })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { fields: Record<string, string> } }).error.fields.email).toBeTruthy()
  })

  it('validates input', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    const res = await call(app, 'POST', '/api/users', { cookie, body: { ...newUser, password: 'short' } })
    expect(res.status).toBe(400)
  })

  it('lets the Deputy Director list officers but not create users', async () => {
    await createUser('OFFICER')
    await createUser('OFFICER', { isActive: false })
    const { cookie } = await loginAs(app, 'DEPUTY_DIRECTOR')
    const list = await call(app, 'GET', '/api/users?role=OFFICER&active=true', { cookie })
    expect(list.status).toBe(200)
    expect((await list.json()) as UserDto[]).toHaveLength(1)
    expect((await call(app, 'POST', '/api/users', { cookie, body: newUser })).status).toBe(403)
  })

  it('forbids officers', async () => {
    const { cookie } = await loginAs(app, 'OFFICER')
    expect((await call(app, 'GET', '/api/users', { cookie })).status).toBe(403)
  })

  it('blocks admins who still have to change their password', async () => {
    const { cookie } = await loginAs(app, 'ADMIN', { mustChangePassword: true })
    expect((await call(app, 'GET', '/api/users', { cookie })).status).toBe(403)
  })

  it('stops an admin from deactivating themselves or changing their own role', async () => {
    const { user, cookie } = await loginAs(app, 'ADMIN')
    expect((await call(app, 'PATCH', `/api/users/${user.id}`, { cookie, body: { isActive: false } })).status).toBe(409)
    expect((await call(app, 'PATCH', `/api/users/${user.id}`, { cookie, body: { role: 'OFFICER' } })).status).toBe(409)
    expect((await call(app, 'PATCH', `/api/users/${user.id}`, { cookie, body: { fullName: 'New Name' } })).status).toBe(200)
  })

  it('signs a deactivated user out immediately', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    const officer = await createUser('OFFICER')
    const officerCookie = await login(app, officer.email)
    const res = await call(app, 'PATCH', `/api/users/${officer.id}`, { cookie, body: { isActive: false } })
    expect(res.status).toBe(200)
    expect((await call(app, 'GET', '/api/auth/me', { cookie: officerCookie })).status).toBe(401)
  })

  it('resets a password: forces a change and signs the user out', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    const officer = await createUser('OFFICER')
    const officerCookie = await login(app, officer.email)
    const res = await call(app, 'POST', `/api/users/${officer.id}/reset-password`, { cookie, body: { password: 'ResetPassword1' } })
    expect(res.status).toBe(204)
    expect((await call(app, 'GET', '/api/auth/me', { cookie: officerCookie })).status).toBe(401)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: officer.id } })).mustChangePassword).toBe(true)
    await expect(login(app, officer.email, 'ResetPassword1')).resolves.toMatch(/^sr_session=/)
  })

  it('returns 404 for unknown users', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    expect((await call(app, 'PATCH', '/api/users/999999', { cookie, body: { fullName: 'Nobody Here' } })).status).toBe(404)
  })

  it('reports upcoming shifts of a deactivated officer and flags them on the roster', async () => {
    const { cookie } = await loginAs(app, 'ADMIN')
    const simon = await createUser('OFFICER', { fullName: 'Simon Gatungo' })
    const antony = await createUser('OFFICER', { fullName: 'Antony Ochieng' })
    const def = await prisma.shiftDefinition.create({ data: { code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00', sortOrder: 1 } })
    await prisma.shift.create({
      data: { shiftDate: new Date('2030-01-07'), shiftDefinitionId: def.id, startsAt: new Date('2030-01-07T05:00:00Z'), endsAt: new Date('2030-01-07T14:00:00Z'), supervisorId: simon.id, officerId: antony.id },
    })
    const res = await call(app, 'PATCH', `/api/users/${simon.id}`, { cookie, body: { isActive: false } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as UpdateUserResult).futureShifts).toBe(1)
    const roster = (await (await call(app, 'GET', '/api/roster?from=2030-01-07&to=2030-01-07', { cookie })).json()) as ShiftDto[]
    expect(roster[0]!.supervisor.rosterable).toBe(false)
    expect(roster[0]!.officer.rosterable).toBe(true)
    const noop = await call(app, 'PATCH', `/api/users/${antony.id}`, { cookie, body: { fullName: 'Antony O' } })
    expect(((await noop.json()) as UpdateUserResult).futureShifts).toBe(0)
  })
})
