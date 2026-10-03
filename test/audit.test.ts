import type { AuditLogDto, Paged } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, loginAs } from './factories'

const app = createApp()

describe('audit log', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('lists entries newest first with the acting user, filtered by entity', async () => {
    const admin = await loginAs(app, 'ADMIN', { fullName: 'Grace Admin' })
    await call(app, 'POST', '/api/config/vehicles', { cookie: admin.cookie, body: { unitId: 'KDG 143S' } })
    const res = await call(app, 'GET', '/api/audit?entity=Vehicle', { cookie: admin.cookie })
    expect(res.status).toBe(200)
    const page = (await res.json()) as Paged<AuditLogDto>
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ entity: 'Vehicle', action: 'CREATE', user: { fullName: 'Grace Admin' }, after: { unitId: 'KDG 143S' } })

    const all = (await (await call(app, 'GET', '/api/audit', { cookie: admin.cookie })).json()) as Paged<AuditLogDto>
    expect(all.items.map((i) => i.action)).toEqual(['CREATE', 'LOGIN'])
  })

  it('filters by local date range', async () => {
    const admin = await loginAs(app, 'ADMIN')
    const empty = (await (await call(app, 'GET', '/api/audit?from=2020-01-01&to=2020-01-31', { cookie: admin.cookie })).json()) as Paged<AuditLogDto>
    expect(empty.total).toBe(0)
  })

  it('is admin-only', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect((await call(app, 'GET', '/api/audit', { cookie: dd.cookie })).status).toBe(403)
  })
})
