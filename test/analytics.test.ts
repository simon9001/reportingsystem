import type { AttentionItemDto, CountByDto, DayNightDto, HotspotDto, IncidentSummaryDto, IncidentTrendDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { incidentAttention } from '../src/analytics/service'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, loginAs } from './factories'
import { insertIncident, resetIncidentSeq, setupIncidentWorld } from './incidentFixtures'

const app = createApp()
const P = 'from=2026-09-01&to=2026-09-30'

describe('incident analytics', () => {
  let world: Awaited<ReturnType<typeof setupIncidentWorld>>
  let cookie: string
  const get = async <T,>(path: string) => (await (await call(app, 'GET', `/api/analytics/incidents/${path}`, { cookie })).json()) as T

  beforeEach(async () => {
    resetIncidentSeq()
    await resetDb()
    world = await setupIncidentWorld()
    cookie = (await loginAs(app, 'DEPUTY_DIRECTOR')).cookie
    // September (current period)
    await insertIncident(world, { occurredAt: '2026-09-29T22:30:00.000Z', severity: 'CRITICAL', categoryValue: 'CCTV', locationValue: 'Isinya W.B', shiftCode: 'NIGHT', escalationResult: 'ON_TIME', minutesToResolve: 30, status: 'RESOLVED' }) // 30/09 local
    await insertIncident(world, { occurredAt: '2026-09-10T08:00:00.000Z', severity: 'HIGH', categoryValue: 'CCTV', locationValue: 'Isinya W.B', escalationResult: 'LATE', minutesToResolve: 60, status: 'CLOSED' })
    await insertIncident(world, { occurredAt: '2026-09-11T08:00:00.000Z', severity: 'LOW', categoryValue: 'Network', locationValue: 'Server room' })
    // August (previous period)
    await insertIncident(world, { occurredAt: '2026-08-15T08:00:00.000Z', severity: 'LOW' })
  })
  afterAll(() => prisma.$disconnect())

  it('summarises the period against the previous one', async () => {
    const s = await get<IncidentSummaryDto>(`summary?${P}`)
    expect(s.total).toEqual({ current: 3, previous: 1 })
    expect(s.avgMinutesToResolve.current).toBe(45)
    expect(s.escalatedOnTimePct.current).toBe(50)
    expect(s.previousFrom).toBe('2026-08-02')
  })

  it('returns trend points per local day', async () => {
    const t = await get<IncidentTrendDto>(`trend?${P}`)
    expect(t.points).toHaveLength(30)
    expect(t.points.find((p) => p.bucket === '2026-09-30')!.CRITICAL).toBe(1)
  })

  it('ranks severities, categories and hotspots', async () => {
    const sev = await get<CountByDto[]>(`by-severity?${P}`)
    expect(sev.map((s) => [s.key, s.count])).toEqual([['CRITICAL', 1], ['HIGH', 1], ['MEDIUM', 0], ['LOW', 1]])
    const cats = await get<CountByDto[]>(`by-category?${P}`)
    expect(cats[0]).toMatchObject({ label: 'CCTV', count: 2 })
    const spots = await get<HotspotDto[]>(`by-location?${P}`)
    expect(spots[0]).toMatchObject({ location: 'Isinya W.B', count: 2, topCategory: 'CCTV' })
  })

  it('splits by shift per week', async () => {
    const d = await get<DayNightDto>(`day-night?${P}`)
    expect(d.shifts.map((s) => s.code)).toEqual(['DAY', 'NIGHT'])
    expect(d.points.reduce((s, p) => s + (p.counts.NIGHT ?? 0), 0)).toBe(1)
  })

  it('lists outstanding critical/high incidents with reasons', async () => {
    await insertIncident(world, { occurredAt: '2026-09-28T08:00:00.000Z', severity: 'HIGH', escalationResult: 'NOT_ESCALATED' })
    const items: AttentionItemDto[] = await incidentAttention(new Date('2026-09-30T08:00:00.000Z'))
    expect(items).toHaveLength(1)
    expect(items[0]!.reasons).toEqual(['Open 48 h', 'Not escalated'])
  })

  it('is for the Deputy Director and administrators only and validates the period', async () => {
    const officer = await loginAs(app, 'OFFICER')
    expect((await call(app, 'GET', `/api/analytics/incidents/summary?${P}`, { cookie: officer.cookie })).status).toBe(403)
    expect((await call(app, 'GET', '/api/analytics/incidents/summary?from=2026-09-30&to=2026-09-01', { cookie })).status).toBe(400)
  })
})
