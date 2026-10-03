import type { EscalationRuleDto, LookupItemDto, Settings, ShiftDefinitionDto, VehicleDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { seedDefaults } from '../src/config/seedDefaults'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, loginAs } from './factories'

const app = createApp()

describe('config', () => {
  beforeEach(async () => {
    await resetDb()
    await seedDefaults(prisma)
  })
  afterAll(() => prisma.$disconnect())

  it('lets any signed-in user read shift definitions but only admins change them', async () => {
    const officer = await loginAs(app, 'OFFICER')
    const res = await call(app, 'GET', '/api/config/shift-definitions', { cookie: officer.cookie })
    const defs = (await res.json()) as ShiftDefinitionDto[]
    expect(defs.map((d) => d.code)).toEqual(['DAY', 'NIGHT'])
    const body = defs.map((d) => ({ id: d.id, name: d.name, startTime: d.startTime, endTime: d.endTime }))
    expect((await call(app, 'PUT', '/api/config/shift-definitions', { cookie: officer.cookie, body })).status).toBe(403)
  })

  it('accepts new times that still cover the day exactly once', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const defs = (await (await call(app, 'GET', '/api/config/shift-definitions', { cookie: admin.cookie })).json()) as ShiftDefinitionDto[]
    const [day, night] = defs
    const res = await call(app, 'PUT', '/api/config/shift-definitions', {
      cookie: admin.cookie,
      body: [
        { id: day!.id, name: 'Day', startTime: '07:00', endTime: '16:00' },
        { id: night!.id, name: 'Night', startTime: '16:00', endTime: '07:00' },
      ],
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as ShiftDefinitionDto[])[0]!.startTime).toBe('07:00')
  })

  it('rejects times that leave a gap or overlap', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const defs = (await (await call(app, 'GET', '/api/config/shift-definitions', { cookie: admin.cookie })).json()) as ShiftDefinitionDto[]
    const res = await call(app, 'PUT', '/api/config/shift-definitions', {
      cookie: admin.cookie,
      body: [{ id: defs[0]!.id, name: 'Day', startTime: '08:00', endTime: '18:00' }],
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('More than one shift covers 17:00')
  })

  it('updates escalation rules', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const rules = (await (await call(app, 'GET', '/api/config/escalation-rules', { cookie: admin.cookie })).json()) as EscalationRuleDto[]
    expect(rules.map((r) => r.severity)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
    const body = rules.map((r) => (r.severity === 'MEDIUM' ? { ...r, isRequired: true, withinMinutes: 60, notifyWho: 'ICT' } : r))
    const res = await call(app, 'PUT', '/api/config/escalation-rules', { cookie: admin.cookie, body })
    expect(res.status).toBe(200)
    expect(((await res.json()) as EscalationRuleDto[])[1]).toMatchObject({ severity: 'MEDIUM', isRequired: true, withinMinutes: 60 })
  })

  it('reads and validates settings', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const ok = await call(app, 'PUT', '/api/config/settings', { cookie: admin.cookie, body: { ddEmails: ['DD@KeNHA.go.ke'], reportDeadlineMinutes: 45 } })
    expect(ok.status).toBe(200)
    expect((await ok.json()) as Settings).toMatchObject({ ddEmails: ['dd@kenha.go.ke'], reportDeadlineMinutes: 45, recurringCount: 3 })
    const bad = await call(app, 'PUT', '/api/config/settings', { cookie: admin.cookie, body: { ddEmails: ['not-an-email'] } })
    expect(bad.status).toBe(400)
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect((await call(app, 'GET', '/api/config/settings', { cookie: dd.cookie })).status).toBe(200)
    expect((await call(app, 'PUT', '/api/config/settings', { cookie: dd.cookie, body: { reportDeadlineMinutes: 10 } })).status).toBe(403)
  })

  it('adds, rejects duplicates of, and deactivates lookup values', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const created = await call(app, 'POST', '/api/config/lookups', { cookie: admin.cookie, body: { listType: 'LOCATION', value: 'Isinya W.B' } })
    expect(created.status).toBe(201)
    const item = (await created.json()) as LookupItemDto
    expect(item.sortOrder).toBe(1)
    expect((await call(app, 'POST', '/api/config/lookups', { cookie: admin.cookie, body: { listType: 'LOCATION', value: 'Isinya W.B' } })).status).toBe(409)
    const off = await call(app, 'PATCH', `/api/config/lookups/${item.id}`, { cookie: admin.cookie, body: { isActive: false } })
    expect(((await off.json()) as LookupItemDto).isActive).toBe(false)
    const active = (await (await call(app, 'GET', '/api/config/lookups?listType=LOCATION&active=true', { cookie: admin.cookie })).json()) as LookupItemDto[]
    expect(active).toHaveLength(0)
  })

  it('stores vehicle IDs in upper case and keeps them unique', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const res = await call(app, 'POST', '/api/config/vehicles', { cookie: admin.cookie, body: { unitId: ' kdg 143s ', description: 'Mobile weighbridge' } })
    expect(res.status).toBe(201)
    expect(((await res.json()) as VehicleDto).unitId).toBe('KDG 143S')
    expect((await call(app, 'POST', '/api/config/vehicles', { cookie: admin.cookie, body: { unitId: 'KDG 143S' } })).status).toBe(409)
  })

  it('audits configuration changes', async () => {
    const admin = await loginAs(app, 'ADMIN')
    await call(app, 'PUT', '/api/config/settings', { cookie: admin.cookie, body: { reportDeadlineMinutes: 40 } })
    expect(await prisma.auditLog.count({ where: { entity: 'SystemSetting', action: 'UPDATE' } })).toBe(1)
  })
})
