import { describe, expect, it } from 'vitest'
import { attentionReasons, buildDayNight, buildHotspots, buildSideTrend, buildTrend, onTimePct, previousPeriod, rankBySide, recurrenceKey } from '../src/analytics/shape'

describe('analytics shaping', () => {
  it('computes the previous period of equal length', () => {
    expect(previousPeriod('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    expect(previousPeriod('2026-09-30', '2026-09-30')).toEqual({ from: '2026-09-29', to: '2026-09-29' })
  })

  it('computes escalated-on-time percentage', () => {
    expect(onTimePct({ ON_TIME: 8, ESCALATED: 1, LATE: 1, NOT_ESCALATED: 0, NOT_REQUIRED: 40 })).toBe(90)
    expect(onTimePct({ NOT_REQUIRED: 5 })).toBeNull()
  })

  it('fills every day with severity counts and a moving average', () => {
    const t = buildTrend([
      { date: '2026-09-01', severity: 'HIGH', count: 2 },
      { date: '2026-09-01', severity: 'LOW', count: 1 },
      { date: '2026-09-03', severity: 'CRITICAL', count: 3 },
    ], '2026-09-01', '2026-09-03')
    expect(t.granularity).toBe('day')
    expect(t.points.map((p) => [p.bucket, p.total])).toEqual([['2026-09-01', 3], ['2026-09-02', 0], ['2026-09-03', 3]])
    expect(t.points[0]).toMatchObject({ HIGH: 2, LOW: 1, movingAvg: 3 })
    expect(t.points[2]!.movingAvg).toBe(2)
  })

  it('switches to Monday weeks for periods longer than 62 days', () => {
    const t = buildTrend([{ date: '2026-03-04', severity: 'LOW', count: 5 }], '2026-01-01', '2026-06-30')
    expect(t.granularity).toBe('week')
    expect(t.points[0]!.bucket).toBe('2025-12-29')
    expect(t.points.find((p) => p.bucket === '2026-03-02')!.LOW).toBe(5)
    expect(t.points.every((p) => p.movingAvg === null)).toBe(true)
  })

  it('groups day and night counts per week', () => {
    const d = buildDayNight(
      [{ date: '2026-09-01', shiftCode: 'NIGHT', count: 4 }, { date: '2026-09-09', shiftCode: 'DAY', count: 2 }],
      '2026-09-01', '2026-09-13',
      [{ code: 'DAY', name: 'Day' }, { code: 'NIGHT', name: 'Night' }],
    )
    expect(d.points).toEqual([
      { weekStart: '2026-08-31', counts: { DAY: 0, NIGHT: 4 } },
      { weekStart: '2026-09-07', counts: { DAY: 2, NIGHT: 0 } },
    ])
  })

  it('explains why an incident needs attention, counting recurrence per station or per vehicle', () => {
    const now = new Date('2026-09-30T12:00:00Z')
    const stat = { occurredAt: new Date('2026-09-29T10:00:00Z'), escalationResult: 'LATE', escalationMinutes: 45, side: 'STATIC', categoryId: 1, locationId: 2, vehicleId: null }
    expect(recurrenceKey(stat)).toBe('S|1|2')
    expect(attentionReasons(stat, now, new Map([['S|1|2', 3]]), { recurringCount: 3, recurringDays: 7 })).toEqual(['Open 26 h', 'Recurring (3 in 7 days)', 'Escalated late (45 min)'])
    const mob = { occurredAt: now, escalationResult: 'NOT_ESCALATED', escalationMinutes: null, side: 'MOBILE', categoryId: 1, locationId: null, vehicleId: 9 }
    expect(recurrenceKey(mob)).toBe('M|1|9')
    expect(attentionReasons(mob, now, new Map([['M|1|9', 4]]), { recurringCount: 3, recurringDays: 7 })).toEqual(['Recurring (4 in 7 days)', 'Not escalated'])
  })

  it('counts static and mobile incidents per trend bucket', () => {
    const t = buildSideTrend([
      { date: '2026-09-01', side: 'STATIC', count: 2 },
      { date: '2026-09-01', side: 'MOBILE', count: 1 },
      { date: '2026-09-02', side: 'MOBILE', count: 4 },
    ], '2026-09-01', '2026-09-02')
    expect(t).toEqual({ granularity: 'day', points: [
      { bucket: '2026-09-01', STATIC: 2, MOBILE: 1, total: 3 },
      { bucket: '2026-09-02', STATIC: 0, MOBILE: 4, total: 4 },
    ] })
  })

  it('ranks keys by total with the static/mobile split, ties broken by key', () => {
    expect(rankBySide([
      { key: 5, side: 'MOBILE', count: 2 }, { key: 3, side: 'STATIC', count: 1 }, { key: 3, side: 'MOBILE', count: 1 }, { key: 9, side: 'STATIC', count: 1 },
    ], 2)).toEqual([{ key: 3, count: 2, static: 1, mobile: 1 }, { key: 5, count: 2, static: 0, mobile: 2 }])
  })

  it('groups hotspots into stations and places, merging typed places that differ only in case or spacing', () => {
    const names = new Map([[1, 'Isinya W.B'], [2, 'Mombasa Road'], [10, 'CCTV'], [11, 'Tracksolid']])
    const h = buildHotspots([
      { side: 'STATIC', locationId: 1, locationText: null, categoryId: 10, count: 3 },
      { side: 'MOBILE', locationId: null, locationText: 'Mlolongo', categoryId: 11, count: 1 },
      { side: 'MOBILE', locationId: null, locationText: ' mlolongo ', categoryId: 11, count: 2 },
      { side: 'MOBILE', locationId: 2, locationText: null, categoryId: 10, count: 1 },
    ], names, 5)
    expect(h).toEqual([
      { key: 'station:1', kind: 'station', location: 'Isinya W.B', count: 3, topCategory: 'CCTV', drill: { side: 'STATIC', locationId: '1' } },
      { key: 'typed:mlolongo', kind: 'place', location: 'Mlolongo', count: 3, topCategory: 'Tracksolid', drill: { side: 'MOBILE', q: 'Mlolongo' } },
      { key: 'place:2', kind: 'place', location: 'Mombasa Road', count: 1, topCategory: 'CCTV', drill: { side: 'MOBILE', locationId: '2' } },
    ])
  })
})
