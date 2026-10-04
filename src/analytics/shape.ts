import { addDays, daysBetween, SEVERITIES, weekStartMonday, type DayNightDto, type IncidentTrendDto, type Severity, type TrendPointDto } from '@sr/shared'

export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const n = daysBetween(from, to) + 1
  return { from: addDays(from, -n), to: addDays(from, -1) }
}

export function onTimePct(counts: Partial<Record<string, number>>): number | null {
  const good = (counts.ON_TIME ?? 0) + (counts.ESCALATED ?? 0)
  const denominator = good + (counts.LATE ?? 0) + (counts.NOT_ESCALATED ?? 0)
  return denominator === 0 ? null : Math.round((good / denominator) * 100)
}

function weeks(from: string, to: string): string[] {
  const out: string[] = []
  for (let w = weekStartMonday(from); w <= to; w = addDays(w, 7)) out.push(w)
  return out
}

export function buildTrend(rows: { date: string; severity: string; count: number }[], from: string, to: string): IncidentTrendDto {
  const n = daysBetween(from, to) + 1
  const granularity = n > 62 ? 'week' : 'day'
  const buckets = granularity === 'day' ? Array.from({ length: n }, (_, i) => addDays(from, i)) : weeks(from, to)
  const map = new Map<string, TrendPointDto>(buckets.map((b) => [b, { bucket: b, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, total: 0, movingAvg: null }]))
  for (const r of rows) {
    const point = map.get(granularity === 'day' ? r.date : weekStartMonday(r.date))
    if (!point || !(SEVERITIES as readonly string[]).includes(r.severity)) continue
    point[r.severity as Severity] += r.count
    point.total += r.count
  }
  const points = [...map.values()]
  if (granularity === 'day') {
    points.forEach((p, i) => {
      const window = points.slice(Math.max(0, i - 6), i + 1)
      p.movingAvg = Math.round((window.reduce((s, x) => s + x.total, 0) / window.length) * 10) / 10
    })
  }
  return { granularity, points }
}

export function buildDayNight(
  rows: { date: string; shiftCode: string; count: number }[],
  from: string,
  to: string,
  shifts: { code: string; name: string }[],
): DayNightDto {
  const points = weeks(from, to).map((weekStart) => ({ weekStart, counts: Object.fromEntries(shifts.map((s) => [s.code, 0])) as Record<string, number> }))
  const byWeek = new Map(points.map((p) => [p.weekStart, p]))
  for (const r of rows) {
    const p = byWeek.get(weekStartMonday(r.date))
    if (p && r.shiftCode in p.counts) p.counts[r.shiftCode]! += r.count
  }
  return { shifts, points }
}

export function attentionReasons(
  i: { occurredAt: Date; escalationResult: string; escalationMinutes: number | null; categoryId: number; locationId: number | null },
  now: Date,
  recurring: Map<string, number>,
  settings: { recurringCount: number; recurringDays: number },
): string[] {
  const reasons: string[] = []
  const hours = Math.floor((now.getTime() - i.occurredAt.getTime()) / 3_600_000)
  if (hours >= 24) reasons.push(`Open ${hours} h`)
  const n = recurring.get(`${i.categoryId}|${i.locationId}`) ?? 0
  if (n >= settings.recurringCount) reasons.push(`Recurring (${n} in ${settings.recurringDays} days)`)
  if (i.escalationResult === 'NOT_ESCALATED') reasons.push('Not escalated')
  if (i.escalationResult === 'LATE') reasons.push(i.escalationMinutes === null ? 'Escalated late' : `Escalated late (${i.escalationMinutes} min)`)
  return reasons
}
