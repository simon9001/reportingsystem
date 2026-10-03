import { describe, expect, it } from 'vitest'
import { attentionReasons, buildDayNight, buildTrend, onTimePct, previousPeriod } from '../src/analytics/shape'

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

  it('explains why an incident needs attention', () => {
    const now = new Date('2026-09-30T12:00:00Z')
    const reasons = attentionReasons(
      { occurredAt: new Date('2026-09-29T10:00:00Z'), escalationResult: 'LATE', escalationMinutes: 45, categoryId: 1, locationId: 2 },
      now, new Map([['1|2', 3]]), { recurringCount: 3, recurringDays: 7 },
    )
    expect(reasons).toEqual(['Open 26 h', 'Recurring (3 in 7 days)', 'Escalated late (45 min)'])
    expect(attentionReasons({ occurredAt: now, escalationResult: 'NOT_ESCALATED', escalationMinutes: null, categoryId: 1, locationId: 2 }, now, new Map(), { recurringCount: 3, recurringDays: 7 })).toEqual(['Not escalated'])
  })
})
