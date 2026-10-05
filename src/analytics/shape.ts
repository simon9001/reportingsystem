import { addDays, daysBetween, INCIDENT_SIDES, SEVERITIES, weekStartMonday, type DayNightDto, type HotspotDto, type IncidentSide, type IncidentTrendDto, type Severity, type SideTrendDto, type TrendPointDto } from '@sr/shared'

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

/** Days for periods up to 62 days, Monday weeks beyond. */
export function trendBuckets(from: string, to: string): { granularity: 'day' | 'week'; buckets: string[]; bucketOf: (date: string) => string } {
  const n = daysBetween(from, to) + 1
  const granularity = n > 62 ? 'week' : 'day'
  const buckets = granularity === 'day' ? Array.from({ length: n }, (_, i) => addDays(from, i)) : weeks(from, to)
  return { granularity, buckets, bucketOf: (d) => (granularity === 'day' ? d : weekStartMonday(d)) }
}

export function buildTrend(rows: { date: string; severity: string; count: number }[], from: string, to: string): IncidentTrendDto {
  const { granularity, buckets, bucketOf } = trendBuckets(from, to)
  const map = new Map<string, TrendPointDto>(buckets.map((b) => [b, { bucket: b, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, total: 0, movingAvg: null }]))
  for (const r of rows) {
    const point = map.get(bucketOf(r.date))
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

export function buildSideTrend(rows: { date: string; side: string; count: number }[], from: string, to: string): SideTrendDto {
  const { granularity, buckets, bucketOf } = trendBuckets(from, to)
  const map = new Map(buckets.map((b) => [b, { bucket: b, STATIC: 0, MOBILE: 0, total: 0 }]))
  for (const r of rows) {
    const point = map.get(bucketOf(r.date))
    if (!point || !(INCIDENT_SIDES as readonly string[]).includes(r.side)) continue
    point[r.side as IncidentSide] += r.count
    point.total += r.count
  }
  return { granularity, points: [...map.values()] }
}

/** Totals per key with the static/mobile split, highest first (ties by key), top `take`. */
export function rankBySide<K extends number | string>(rows: { key: K; side: string; count: number }[], take: number): { key: K; count: number; static: number; mobile: number }[] {
  const map = new Map<K, { key: K; count: number; static: number; mobile: number }>()
  for (const r of rows) {
    const e = map.get(r.key) ?? { key: r.key, count: 0, static: 0, mobile: 0 }
    e.count += r.count
    if (r.side === 'MOBILE') e.mobile += r.count
    else e.static += r.count
    map.set(r.key, e)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, take)
}

/** Top `take` static stations and top `take` mobile places; typed places are merged ignoring case and surrounding spaces. */
export function buildHotspots(
  rows: { side: string; locationId: number | null; locationText: string | null; categoryId: number; count: number }[],
  names: Map<number, string>,
  take: number,
  placeIds: Map<string, number> = new Map(),
): HotspotDto[] {
  const groups = new Map<string, { kind: 'station' | 'place'; location: string; count: number; cats: Map<number, number>; drill: Record<string, string> }>()
  for (const r of rows) {
    let key: string
    let entry: { kind: 'station' | 'place'; location: string; drill: Record<string, string> }
    let typed = false
    if (r.side === 'STATIC' && r.locationId !== null) {
      key = `station:${r.locationId}`
      entry = { kind: 'station', location: names.get(r.locationId) ?? 'Unknown', drill: { side: 'STATIC', locationId: String(r.locationId) } }
    } else if (r.side === 'MOBILE' && r.locationId !== null) {
      key = `place:${r.locationId}`
      entry = { kind: 'place', location: names.get(r.locationId) ?? 'Unknown', drill: { side: 'MOBILE', locationId: String(r.locationId) } }
    } else if (r.side === 'MOBILE' && r.locationText?.trim()) {
      const text = r.locationText.trim()
      const listedId = placeIds.get(text.toLowerCase())
      if (listedId !== undefined) {
        typed = true
        // Typed text that spells a listed place counts toward that place.
        const listed = names.get(listedId) ?? text
        key = `place:${listedId}`
        entry = { kind: 'place', location: listed, drill: { side: 'MOBILE', q: listed } }
      } else {
        key = `typed:${text.toLowerCase()}`
        entry = { kind: 'place', location: text, drill: { side: 'MOBILE', q: text } }
      }
    } else continue
    const g = groups.get(key) ?? { ...entry, count: 0, cats: new Map<number, number>() }
    // A listed place that also holds typed rows is drilled by name so the explorer's search finds both kinds.
    if (typed) g.drill = entry.drill
    g.count += r.count
    g.cats.set(r.categoryId, (g.cats.get(r.categoryId) ?? 0) + r.count)
    groups.set(key, g)
  }
  const ranked = [...groups.entries()]
    .map(([key, g]) => {
      const top = [...g.cats.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
      return { key, kind: g.kind, location: g.location, count: g.count, topCategory: top ? names.get(top[0]) ?? null : null, drill: g.drill }
    })
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
  return [...ranked.filter((h) => h.kind === 'station').slice(0, take), ...ranked.filter((h) => h.kind === 'place').slice(0, take)]
}

/** Recurrence is counted per category at a station (static) or per category on a vehicle (mobile). */
export const recurrenceKey = (i: { side: string; categoryId: number; locationId: number | null; vehicleId: number | null }) =>
  i.side === 'MOBILE' ? `M|${i.categoryId}|${i.vehicleId}` : `S|${i.categoryId}|${i.locationId}`

export function attentionReasons(
  i: { occurredAt: Date; escalationResult: string; escalationMinutes: number | null; side: string; categoryId: number; locationId: number | null; vehicleId: number | null },
  now: Date,
  recurring: Map<string, number>,
  settings: { recurringCount: number; recurringDays: number },
): string[] {
  const reasons: string[] = []
  const hours = Math.floor((now.getTime() - i.occurredAt.getTime()) / 3_600_000)
  if (hours >= 24) reasons.push(`Open ${hours} h`)
  const n = recurring.get(recurrenceKey(i)) ?? 0
  if (n >= settings.recurringCount) reasons.push(`Recurring (${n} in ${settings.recurringDays} days)`)
  if (i.escalationResult === 'NOT_ESCALATED') reasons.push('Not escalated')
  if (i.escalationResult === 'LATE') reasons.push(i.escalationMinutes === null ? 'Escalated late' : `Escalated late (${i.escalationMinutes} min)`)
  return reasons
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
