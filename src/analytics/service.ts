import {
  addDays, OUTSTANDING_STATUSES, SEVERITIES, SEVERITY_LABELS, toDateString,
  type AttentionItemDto, type CountByDto, type DayNightDto, type HotspotDto, type IncidentStatus, type IncidentSummaryDto, type IncidentTrendDto, type Severity,
} from '@sr/shared'
import { getSettings } from '../config/settings'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { localTime } from '../lib/shiftTime'
import { attentionReasons, buildDayNight, buildTrend, onTimePct, previousPeriod } from './shape'

const tz = () => env.SR_APP_TIMEZONE
const period = (from: string, to: string) => ({ gte: localTime(from, '00:00', tz()), lt: localTime(addDays(to, 1), '00:00', tz()) })
const outstanding = [...OUTSTANDING_STATUSES]

async function periodStats(from: string, to: string) {
  const where = { occurredAt: period(from, to) }
  const [total, avg, escalation] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.aggregate({ where: { ...where, minutesToResolve: { not: null } }, _avg: { minutesToResolve: true } }),
    prisma.incident.groupBy({ by: ['escalationResult'], where, _count: { _all: true } }),
  ])
  const counts = Object.fromEntries(escalation.map((r) => [r.escalationResult, r._count._all]))
  const avgMinutes = avg._avg.minutesToResolve
  return { total, avg: avgMinutes === null ? null : Math.round(avgMinutes), onTime: onTimePct(counts) }
}

export async function incidentSummary(from: string, to: string, now = new Date()): Promise<IncidentSummaryDto> {
  const prev = previousPeriod(from, to)
  const openWhere = { status: { in: outstanding }, severity: { in: ['HIGH', 'CRITICAL'] } }
  const [cur, before, openCriticalHigh, openCriticalHighOver24h] = await Promise.all([
    periodStats(from, to),
    periodStats(prev.from, prev.to),
    prisma.incident.count({ where: openWhere }),
    prisma.incident.count({ where: { ...openWhere, occurredAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } }),
  ])
  return {
    previousFrom: prev.from,
    previousTo: prev.to,
    total: { current: cur.total, previous: before.total },
    avgMinutesToResolve: { current: cur.avg, previous: before.avg },
    escalatedOnTimePct: { current: cur.onTime, previous: before.onTime },
    openCriticalHigh,
    openCriticalHighOver24h,
  }
}

export async function incidentTrend(from: string, to: string): Promise<IncidentTrendDto> {
  const rows = await prisma.incident.groupBy({ by: ['occurredLocalDate', 'severity'], where: { occurredAt: period(from, to) }, _count: { _all: true } })
  return buildTrend(rows.map((r) => ({ date: toDateString(r.occurredLocalDate), severity: r.severity, count: r._count._all })), from, to)
}

export async function incidentsBySeverity(from: string, to: string): Promise<CountByDto[]> {
  const rows = await prisma.incident.groupBy({ by: ['severity'], where: { occurredAt: period(from, to) }, _count: { _all: true } })
  const counts = new Map(rows.map((r) => [r.severity, r._count._all]))
  return [...SEVERITIES].reverse().map((s: Severity) => ({ key: s, label: SEVERITY_LABELS[s], count: counts.get(s) ?? 0 }))
}

async function lookupNames(ids: number[]): Promise<Map<number, string>> {
  const items = await prisma.lookupItem.findMany({ where: { id: { in: ids } }, select: { id: true, value: true } })
  return new Map(items.map((i) => [i.id, i.value]))
}

export async function incidentsByCategory(from: string, to: string, take = 6): Promise<CountByDto[]> {
  const rows = await prisma.incident.groupBy({
    by: ['categoryId'], where: { occurredAt: period(from, to) }, _count: { categoryId: true }, orderBy: { _count: { categoryId: 'desc' } }, take,
  })
  const names = await lookupNames(rows.map((r) => r.categoryId))
  return rows.map((r) => ({ key: String(r.categoryId), label: names.get(r.categoryId) ?? 'Unknown', count: r._count.categoryId }))
}

export async function incidentHotspots(from: string, to: string, take = 5): Promise<HotspotDto[]> {
  const where = { occurredAt: period(from, to) }
  const top = await prisma.incident.groupBy({ by: ['locationId'], where, _count: { locationId: true }, orderBy: { _count: { locationId: 'desc' } }, take })
  const ids = top.map((t) => t.locationId)
  const pairs = await prisma.incident.groupBy({ by: ['locationId', 'categoryId'], where: { ...where, locationId: { in: ids } }, _count: { _all: true } })
  const names = await lookupNames([...ids, ...pairs.map((p) => p.categoryId)])
  return top.map((t) => {
    const best = pairs.filter((p) => p.locationId === t.locationId).sort((a, b) => b._count._all - a._count._all)[0]
    return { locationId: t.locationId, location: names.get(t.locationId) ?? 'Unknown', count: t._count.locationId, topCategory: best ? names.get(best.categoryId) ?? null : null }
  })
}

export async function incidentDayNight(from: string, to: string): Promise<DayNightDto> {
  const [rows, defs] = await Promise.all([
    prisma.incident.groupBy({ by: ['occurredLocalDate', 'shiftCode'], where: { occurredAt: period(from, to) }, _count: { _all: true } }),
    prisma.shiftDefinition.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
  ])
  return buildDayNight(
    rows.map((r) => ({ date: toDateString(r.occurredLocalDate), shiftCode: r.shiftCode, count: r._count._all })),
    from, to, defs.map((d) => ({ code: d.code, name: d.name })),
  )
}

export async function incidentAttention(now = new Date()): Promise<AttentionItemDto[]> {
  const settings = await getSettings()
  const [rows, recurringRows] = await Promise.all([
    prisma.incident.findMany({
      where: { status: { in: outstanding }, severity: { in: ['HIGH', 'CRITICAL'] } },
      include: { location: true, category: true },
      orderBy: [{ severityRank: 'desc' }, { occurredAt: 'asc' }],
      take: 50,
    }),
    prisma.incident.groupBy({
      by: ['categoryId', 'locationId'],
      where: { occurredAt: { gte: new Date(now.getTime() - settings.recurringDays * 86_400_000) } },
      _count: { _all: true },
    }),
  ])
  const recurring = new Map(recurringRows.map((r) => [`${r.categoryId}|${r.locationId}`, r._count._all]))
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    occurredAt: r.occurredAt.toISOString(),
    location: r.location.value,
    category: r.category.value,
    severity: r.severity as Severity,
    status: r.status as IncidentStatus,
    reasons: attentionReasons(r, now, recurring, settings),
  }))
}
