import type { AttentionItemDto, CountByDto, DayNightDto, HotspotDto, IncidentSummaryDto, IncidentTrendDto, MobileHealthDto, SideTrendDto } from '@sr/shared'
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
    const items: AttentionItemDto[] = await incidentAttention(undefined, new Date('2026-09-30T08:00:00.000Z'))
    expect(items).toHaveLength(1)
    expect(items[0]!.reasons).toEqual(['Open 48 h', 'Not escalated'])
  })

  it('is for the Deputy Director and administrators only and validates the period', async () => {
    const officer = await loginAs(app, 'OFFICER')
    expect((await call(app, 'GET', `/api/analytics/incidents/summary?${P}`, { cookie: officer.cookie })).status).toBe(403)
    expect((await call(app, 'GET', '/api/analytics/incidents/summary?from=2026-09-30&to=2026-09-01', { cookie })).status).toBe(400)
  })
})

describe('incident analytics for static and mobile weighbridges', () => {
  let world: Awaited<ReturnType<typeof setupIncidentWorld>>
  let cookie: string
  const get = async <T,>(path: string) => (await (await call(app, 'GET', `/api/analytics/incidents/${path}`, { cookie })).json()) as T

  beforeEach(async () => {
    resetIncidentSeq()
    await resetDb()
    world = await setupIncidentWorld()
    cookie = (await loginAs(app, 'DEPUTY_DIRECTOR')).cookie
    await insertIncident(world, { occurredAt: '2026-09-10T08:00:00.000Z', severity: 'CRITICAL', categoryValue: 'CCTV', locationValue: 'Isinya W.B', status: 'OPEN', minutesToResolve: 40 })
    await insertIncident(world, { occurredAt: '2026-09-11T08:00:00.000Z', severity: 'LOW', categoryValue: 'Network', locationValue: 'Server room', status: 'CLOSED' })
    await insertIncident(world, { occurredAt: '2026-09-12T08:00:00.000Z', side: 'MOBILE', severity: 'HIGH', categoryValue: 'Tracksolid', locationText: 'Mlolongo', gpsStatus: 'OFFLINE', status: 'OPEN', escalationResult: 'NOT_ESCALATED' })
    await insertIncident(world, { occurredAt: '2026-09-13T08:00:00.000Z', side: 'MOBILE', severity: 'MEDIUM', categoryValue: 'Tracksolid', locationText: ' mlolongo ', dashcamStatus: 'OFFLINE', minutesToResolve: 20, status: 'RESOLVED' })
    await insertIncident(world, { occurredAt: '2026-09-14T08:00:00.000Z', side: 'MOBILE', severity: 'LOW', categoryValue: 'MettaX', vehicleUnitId: 'KCB 220T', platformValue: 'MettaX', locationValue: 'Mombasa Road', vehicleStatus: 'OFFLINE' })
  })

  it('splits the summary by side, and the sides add up to the total', async () => {
    const s = await get<IncidentSummaryDto>(`summary?${P}`)
    expect(s.total.current).toBe(5)
    expect(s.bySide.STATIC).toEqual({ total: 2, avgMinutesToResolve: 40, escalatedOnTimePct: null, openCriticalHigh: 1 })
    expect(s.bySide.MOBILE).toMatchObject({ total: 3, avgMinutesToResolve: 20, escalatedOnTimePct: 0, openCriticalHigh: 1 })
    expect(s.bySide.STATIC.total + s.bySide.MOBILE.total).toBe(s.total.current)
    expect(s.openCriticalHigh).toBe(2)
    expect((await get<IncidentSummaryDto>(`summary?${P}&side=MOBILE`)).total.current).toBe(3)
  })

  it('compares the sides over time', async () => {
    const t = await get<SideTrendDto>(`by-side-trend?${P}`)
    expect(t.points.reduce((n, p) => n + p.STATIC, 0)).toBe(2)
    expect(t.points.reduce((n, p) => n + p.MOBILE, 0)).toBe(3)
  })

  it('splits categories and severities by side, and filters every chart by side', async () => {
    const cats = await get<CountByDto[]>(`by-category?${P}`)
    expect(cats[0]).toMatchObject({ label: 'Tracksolid', count: 2, static: 0, mobile: 2 })
    expect((await get<CountByDto[]>(`by-category?${P}&side=STATIC`)).map((c) => c.label)).not.toContain('Tracksolid')
    const sev = await get<CountByDto[]>(`by-severity?${P}`)
    expect(sev.find((x) => x.key === 'HIGH')).toMatchObject({ count: 1, static: 0, mobile: 1 })
    const trend = await get<IncidentTrendDto>(`trend?${P}&side=STATIC`)
    expect(trend.points.reduce((n, p) => n + p.total, 0)).toBe(2)
    const dn = await get<DayNightDto>(`day-night?${P}&side=MOBILE`)
    expect(dn.points.reduce((n, p) => n + (p.counts.DAY ?? 0), 0)).toBe(3)
  })

  it('reports stations and mobile places as hotspots', async () => {
    const mombasa = await prisma.lookupItem.findFirstOrThrow({ where: { listType: 'LOCATION', value: 'Mombasa Road' } })
    const h = await get<HotspotDto[]>(`by-location?${P}`)
    expect(h.filter((x) => x.kind === 'station').map((x) => x.location)).toEqual(['Isinya W.B', 'Server room'])
    expect(h.find((x) => x.key === 'typed:mlolongo')).toMatchObject({ kind: 'place', count: 2, drill: { side: 'MOBILE', q: 'Mlolongo' } })
    expect(h.find((x) => x.location === 'Mombasa Road')).toMatchObject({ kind: 'place', drill: { side: 'MOBILE', locationId: String(mombasa.id) } })
  })

  it('ranks mobile units and reports equipment health and platforms', async () => {
    const v = await get<CountByDto[]>(`by-vehicle?${P}`)
    expect(v.map((x) => [x.label, x.count])).toEqual([['KDG 143S', 2], ['KCB 220T', 1]])
    const m = await get<MobileHealthDto>(`mobile-health?${P}`)
    expect(m).toMatchObject({ total: 3, gpsOffline: 1, dashcamOffline: 1, vehicleOffline: 1, gpsUnknown: 0, dashcamUnknown: 0 })
    expect(m.platforms.map((p) => [p.label, p.count])).toEqual([['Tracksolid', 2], ['MettaX', 1]])
  })

  it('lists attention items per side with the vehicle', async () => {
    const all = await get<AttentionItemDto[]>('attention')
    expect(all.map((i) => i.side).sort()).toEqual(['MOBILE', 'STATIC'])
    const mobile = await get<AttentionItemDto[]>('attention?side=MOBILE')
    expect(mobile).toHaveLength(1)
    expect(mobile[0]).toMatchObject({ side: 'MOBILE', vehicle: 'KDG 143S', location: 'Mlolongo' })
  })
})
