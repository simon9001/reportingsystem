import {
  addDays, INCIDENT_SIDES, OUTSTANDING_STATUSES, SEVERITIES, SEVERITY_LABELS, toDateString,
  type AttentionItemDto, type CountByDto, type DayNightDto, type HotspotDto, type IncidentSide, type IncidentStatus, type IncidentSummaryDto,
  type IncidentTrendDto, type MobileHealthDto, type Severity, type SideStats, type SideTrendDto,
} from '@sr/shared'
import { getSettings } from '../config/settings'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { localTime } from '../lib/shiftTime'
import { attentionReasons, buildDayNight, buildHotspots, buildSideTrend, buildTrend, onTimePct, previousPeriod, rankBySide, recurrenceKey } from './shape'

const tz = () => env.SR_APP_TIMEZONE
const period = (from: string, to: string) => ({ gte: localTime(from, '00:00', tz()), lt: localTime(addDays(to, 1), '00:00', tz()) })
const scope = (from: string, to: string, side?: IncidentSide) => ({ occurredAt: period(from, to), ...(side ? { side } : {}) })
const outstanding = [...OUTSTANDING_STATUSES]
const openCriticalHighWhere = (side?: IncidentSide) => ({ status: { in: outstanding }, severity: { in: ['HIGH', 'CRITICAL'] }, ...(side ? { side } : {}) })

async function periodStats(from: string, to: string, side?: IncidentSide) {
  const where = scope(from, to, side)
  const [total, avg, escalation] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.aggregate({ where: { ...where, minutesToResolve: { not: null } }, _avg: { minutesToResolve: true } }),
    prisma.incident.groupBy({ by: ['escalationResult'], where, _count: { _all: true } }),
  ])
  const counts = Object.fromEntries(escalation.map((r) => [r.escalationResult, r._count._all]))
  const avgMinutes = avg._avg.minutesToResolve
  return { total, avg: avgMinutes === null ? null : Math.round(avgMinutes), onTime: onTimePct(counts) }
}

async function sideStats(from: string, to: string, side: IncidentSide): Promise<SideStats> {
  const [s, open] = await Promise.all([periodStats(from, to, side), prisma.incident.count({ where: openCriticalHighWhere(side) })])
  return { total: s.total, avgMinutesToResolve: s.avg, escalatedOnTimePct: s.onTime, openCriticalHigh: open }
}

export async function incidentSummary(from: string, to: string, side?: IncidentSide, now = new Date()): Promise<IncidentSummaryDto> {
  const prev = previousPeriod(from, to)
  const [cur, before, openCriticalHigh, openCriticalHighOver24h, staticStats, mobileStats] = await Promise.all([
    periodStats(from, to, side),
    periodStats(prev.from, prev.to, side),
    prisma.incident.count({ where: openCriticalHighWhere(side) }),
    prisma.incident.count({ where: { ...openCriticalHighWhere(side), occurredAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } }),
    sideStats(from, to, 'STATIC'),
    sideStats(from, to, 'MOBILE'),
  ])
  return {
    previousFrom: prev.from,
    previousTo: prev.to,
    total: { current: cur.total, previous: before.total },
    avgMinutesToResolve: { current: cur.avg, previous: before.avg },
    escalatedOnTimePct: { current: cur.onTime, previous: before.onTime },
    openCriticalHigh,
    openCriticalHighOver24h,
    bySide: { STATIC: staticStats, MOBILE: mobileStats },
  }
}

export async function incidentTrend(from: string, to: string, side?: IncidentSide): Promise<IncidentTrendDto> {
  const rows = await prisma.incident.groupBy({ by: ['occurredLocalDate', 'severity'], where: scope(from, to, side), _count: { _all: true } })
  return buildTrend(rows.map((r) => ({ date: toDateString(r.occurredLocalDate), severity: r.severity, count: r._count._all })), from, to)
}

export async function incidentSideTrend(from: string, to: string): Promise<SideTrendDto> {
  const rows = await prisma.incident.groupBy({ by: ['occurredLocalDate', 'side'], where: scope(from, to), _count: { _all: true } })
  return buildSideTrend(rows.map((r) => ({ date: toDateString(r.occurredLocalDate), side: r.side, count: r._count._all })), from, to)
}

export async function incidentsBySeverity(from: string, to: string, side?: IncidentSide): Promise<CountByDto[]> {
  const rows = await prisma.incident.groupBy({ by: ['severity', 'side'], where: scope(from, to, side), _count: { _all: true } })
  const ranked = new Map(rankBySide(rows.map((r) => ({ key: r.severity, side: r.side, count: r._count._all })), SEVERITIES.length).map((x) => [x.key, x]))
  return [...SEVERITIES].reverse().map((s: Severity) => {
    const x = ranked.get(s)
    return { key: s, label: SEVERITY_LABELS[s], count: x?.count ?? 0, static: x?.static ?? 0, mobile: x?.mobile ?? 0 }
  })
}

async function lookupNames(ids: number[]): Promise<Map<number, string>> {
  const items = await prisma.lookupItem.findMany({ where: { id: { in: ids } }, select: { id: true, value: true } })
  return new Map(items.map((i) => [i.id, i.value]))
}

export async function incidentsByCategory(from: string, to: string, side?: IncidentSide, take = 6): Promise<CountByDto[]> {
  const rows = await prisma.incident.groupBy({ by: ['categoryId', 'side'], where: scope(from, to, side), _count: { _all: true } })
  const ranked = rankBySide(rows.map((r) => ({ key: r.categoryId, side: r.side, count: r._count._all })), take)
  const names = await lookupNames(ranked.map((r) => r.key))
  return ranked.map((r) => ({ key: String(r.key), label: names.get(r.key) ?? 'Unknown', count: r.count, static: r.static, mobile: r.mobile }))
}

export async function incidentHotspots(from: string, to: string, side?: IncidentSide, take = 5): Promise<HotspotDto[]> {
  const where = scope(from, to, side)
  // SQL Server groups text case-insensitively and returns an arbitrary spelling, so typed places are read as-is and merged in buildHotspots.
  const [rows, typed] = await Promise.all([
    prisma.incident.groupBy({ by: ['side', 'locationId', 'categoryId'], where: { ...where, locationId: { not: null } }, _count: { _all: true } }),
    prisma.incident.findMany({ where: { ...where, locationId: null, locationText: { not: null } }, select: { side: true, locationText: true, categoryId: true }, orderBy: { occurredAt: 'asc' } }),
  ])
  const ids = [...new Set([...rows.flatMap((r) => [r.locationId!, r.categoryId]), ...typed.map((t) => t.categoryId)])]
  const names = await lookupNames(ids)
  return buildHotspots(
    [
      ...rows.map((r) => ({ side: r.side, locationId: r.locationId, locationText: null, categoryId: r.categoryId, count: r._count._all })),
      ...typed.map((t) => ({ side: t.side, locationId: null, locationText: t.locationText, categoryId: t.categoryId, count: 1 })),
    ],
    names,
    take,
  )
}

export async function incidentDayNight(from: string, to: string, side?: IncidentSide): Promise<DayNightDto> {
  const [rows, defs] = await Promise.all([
    prisma.incident.groupBy({ by: ['occurredLocalDate', 'shiftCode'], where: scope(from, to, side), _count: { _all: true } }),
    prisma.shiftDefinition.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ])
  return buildDayNight(
    rows.map((r) => ({ date: toDateString(r.occurredLocalDate), shiftCode: r.shiftCode, count: r._count._all })),
    from, to, defs.map((d) => ({ code: d.code, name: d.name })),
  )
}

export async function incidentsByVehicle(from: string, to: string, take = 10): Promise<CountByDto[]> {
  const rows = await prisma.incident.groupBy({
    by: ['vehicleId'], where: { ...scope(from, to, 'MOBILE'), vehicleId: { not: null } }, _count: { vehicleId: true }, orderBy: { _count: { vehicleId: 'desc' } }, take,
  })
  const vehicles = await prisma.vehicle.findMany({ where: { id: { in: rows.map((r) => r.vehicleId!) } }, select: { id: true, unitId: true } })
  const names = new Map(vehicles.map((v) => [v.id, v.unitId]))
  return rows.map((r) => ({ key: String(r.vehicleId), label: names.get(r.vehicleId!) ?? 'Unknown', count: r._count.vehicleId, static: 0, mobile: r._count.vehicleId }))
}

export async function incidentMobileHealth(from: string, to: string): Promise<MobileHealthDto> {
  const where = scope(from, to, 'MOBILE')
  const [total, gps, dashcam, vehicle, platforms] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.groupBy({ by: ['gpsStatus'], where, _count: { _all: true } }),
    prisma.incident.groupBy({ by: ['dashcamStatus'], where, _count: { _all: true } }),
    prisma.incident.groupBy({ by: ['vehicleStatus'], where, _count: { _all: true } }),
    prisma.incident.groupBy({ by: ['platformId'], where: { ...where, platformId: { not: null } }, _count: { platformId: true }, orderBy: { _count: { platformId: 'desc' } } }),
  ])
  const tally = <T,>(rows: (T & { _count: { _all: number } })[], pick: (r: T) => string | null, value: string) =>
    rows.reduce((n, r) => (pick(r) === value ? n + r._count._all : n), 0)
  const names = await lookupNames(platforms.map((p) => p.platformId!))
  return {
    total,
    gpsOffline: tally(gps, (r) => r.gpsStatus, 'OFFLINE'),
    gpsUnknown: tally(gps, (r) => r.gpsStatus, 'UNKNOWN'),
    dashcamOffline: tally(dashcam, (r) => r.dashcamStatus, 'OFFLINE'),
    dashcamUnknown: tally(dashcam, (r) => r.dashcamStatus, 'UNKNOWN'),
    vehicleOffline: tally(vehicle, (r) => r.vehicleStatus, 'OFFLINE'),
    platforms: platforms.map((p) => ({ key: String(p.platformId), label: names.get(p.platformId!) ?? 'Unknown', count: p._count.platformId, static: 0, mobile: p._count.platformId })),
  }
}

export async function incidentAttention(side?: IncidentSide, now = new Date()): Promise<AttentionItemDto[]> {
  const settings = await getSettings()
  const [rows, recurringRows] = await Promise.all([
    prisma.incident.findMany({
      where: openCriticalHighWhere(side),
      include: { location: true, category: true, vehicle: true },
      orderBy: [{ severityRank: 'desc' }, { occurredAt: 'asc' }],
      take: 50,
    }),
    prisma.incident.groupBy({
      by: ['side', 'categoryId', 'locationId', 'vehicleId'],
      where: { occurredAt: { gte: new Date(now.getTime() - settings.recurringDays * 86_400_000) } },
      _count: { _all: true },
    }),
  ])
  const recurring = new Map<string, number>()
  for (const r of recurringRows) {
    const key = recurrenceKey(r)
    recurring.set(key, (recurring.get(key) ?? 0) + r._count._all)
  }
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    side: (INCIDENT_SIDES as readonly string[]).includes(r.side) ? (r.side as IncidentSide) : 'STATIC',
    occurredAt: r.occurredAt.toISOString(),
    location: r.location?.value ?? r.locationText ?? '—',
    vehicle: r.vehicle?.unitId ?? null,
    category: r.category.value,
    severity: r.severity as Severity,
    status: r.status as IncidentStatus,
    reasons: attentionReasons(r, now, recurring, settings),
  }))
}
