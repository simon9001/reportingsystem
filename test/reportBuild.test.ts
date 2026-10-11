import type { ReportShiftDto } from '@sr/shared'
import { describe, expect, it } from 'vitest'
import { buildReportContent, computeTimeliness, reportDeadline, type ReportIncidentInput } from '../src/reports/build'

const shift: ReportShiftDto = {
  id: 7, shiftDate: '2026-09-28', shiftCode: 'DAY', shiftName: 'Day',
  startsAt: '2026-09-28T05:00:00.000Z', endsAt: '2026-09-28T14:00:00.000Z',
  supervisor: { id: 1, fullName: 'Antony Ochieng' }, officer: { id: 2, fullName: 'Simon Gatungo' },
}

let n = 0
const inc = (o: Partial<ReportIncidentInput>): ReportIncidentInput => {
  n += 1
  return {
    id: n, ref: `INC-2026-${String(n).padStart(4, '0')}`, side: 'STATIC', occurredAt: `2026-09-28T0${n}:00:00.000Z`,
    place: 'Weighbridge 04', category: 'CCTV', severity: 'LOW', status: 'RESOLVED', escalationResult: 'NOT_REQUIRED',
    minutesToResolve: 40, description: 'Camera offline', ...o,
  }
}

/** The user manual's worked example: 5 incidents. */
function manualExample() {
  n = 0
  return [
    inc({ severity: 'HIGH', escalationResult: 'ON_TIME', minutesToResolve: 30 }),
    inc({ severity: 'MEDIUM', category: 'Mobile Weighbridge', side: 'MOBILE', place: 'KDG 143S · Mlolongo', minutesToResolve: 40 }),
    inc({ severity: 'MEDIUM', category: 'Other', minutesToResolve: 50 }),
    inc({ severity: 'LOW', category: 'Other', minutesToResolve: 40 }),
    inc({ severity: 'LOW', status: 'OPEN', minutesToResolve: null }),
  ]
}

describe('report deadline and timeliness', () => {
  it('adds the deadline minutes to the shift end', () => {
    expect(reportDeadline(new Date('2026-09-28T14:00:00Z'), 30).toISOString()).toBe('2026-09-28T14:30:00.000Z')
  })
  it('is on time up to and including the deadline, then late by whole minutes rounded up', () => {
    const end = new Date('2026-09-28T14:00:00Z')
    expect(computeTimeliness(new Date('2026-09-28T13:55:00Z'), end, 30)).toEqual({ timeliness: 'ON_TIME', lateMinutes: null })
    expect(computeTimeliness(new Date('2026-09-28T14:30:00Z'), end, 30)).toEqual({ timeliness: 'ON_TIME', lateMinutes: null })
    expect(computeTimeliness(new Date('2026-09-28T14:30:01Z'), end, 30)).toEqual({ timeliness: 'LATE', lateMinutes: 1 })
    expect(computeTimeliness(new Date('2026-09-28T14:42:00Z'), end, 30)).toEqual({ timeliness: 'LATE', lateMinutes: 12 })
  })
  it('uses the real end of a night shift that ends the next morning', () => {
    // Night of 28 Sep: 17:00 → 08:00 on 29 Sep (Nairobi = UTC+3)
    const end = new Date('2026-09-29T05:00:00Z')
    expect(computeTimeliness(new Date('2026-09-29T05:20:00Z'), end, 30)).toEqual({ timeliness: 'ON_TIME', lateMinutes: null })
    expect(computeTimeliness(new Date('2026-09-29T05:45:00Z'), end, 30)).toEqual({ timeliness: 'LATE', lateMinutes: 15 })
  })
})

describe('buildReportContent', () => {
  it('reproduces the manual example figures', () => {
    const c = buildReportContent(shift, manualExample(), 30, { overview: 'Busy', pendingActions: 'Watch WB04' })
    expect(c.figures.total).toBe(5)
    expect(c.figures.bySeverity).toEqual({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 2 })
    expect(c.figures.byStatus.RESOLVED).toBe(4)
    expect(c.figures.openAtEnd).toBe(1)
    expect(c.figures.byCategory).toEqual([{ label: 'CCTV', count: 2 }, { label: 'Other', count: 2 }, { label: 'Mobile Weighbridge', count: 1 }])
    expect(c.figures.avgMinutesToResolve).toBe(40)
    expect(c.figures.bySide).toEqual({ STATIC: 4, MOBILE: 1 })
    expect(c.figures.escalation.ON_TIME).toBe(1)
    expect(c.criticalHigh.map((r) => r.ref)).toEqual(['INC-2026-0001'])
    expect(c.open.map((r) => r.ref)).toEqual(['INC-2026-0005'])
    expect(c.incidents).toHaveLength(5)
    expect(c.deadline).toBe('2026-09-28T14:30:00.000Z')
    expect(c.checks).toEqual([])
    expect(c.incidents[0]).not.toHaveProperty('description')
  })

  it('warns about unescalated critical/high, empty descriptions and open items without pending actions', () => {
    n = 0
    const c = buildReportContent(shift, [
      inc({ severity: 'CRITICAL', escalationResult: 'NOT_ESCALATED', status: 'OPEN', minutesToResolve: null }),
      inc({ severity: 'HIGH', escalationResult: 'LATE', description: '   ' }),
    ], 30, { overview: 'x', pendingActions: null })
    expect(c.checks.map((x) => x.code)).toEqual(['NOT_ESCALATED', 'NOT_ESCALATED', 'EMPTY_DESCRIPTION', 'OPEN_WITHOUT_PENDING_ACTIONS'])
    expect(c.checks[0]).toMatchObject({ ref: 'INC-2026-0001', message: 'INC-2026-0001 is Critical and was not escalated' })
    expect(c.checks[1]!.message).toBe('INC-2026-0002 is High and was escalated late')
  })

  it('asks for an overview on a quiet shift and handles no incidents', () => {
    const c = buildReportContent(shift, [], 30, { overview: null, pendingActions: null })
    expect(c.figures.total).toBe(0)
    expect(c.figures.avgMinutesToResolve).toBeNull()
    expect(c.checks.map((x) => x.code)).toEqual(['QUIET_WITHOUT_OVERVIEW'])
  })
})
