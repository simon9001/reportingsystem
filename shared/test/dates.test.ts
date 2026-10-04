import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, fromDateString, localDateString, toDateString, weekStartMonday } from '../src/dates'

describe('date helpers', () => {
  it('round-trips date strings through UTC midnight', () => {
    expect(fromDateString('2026-09-30').toISOString()).toBe('2026-09-30T00:00:00.000Z')
    expect(toDateString(new Date('2026-09-30T23:59:00Z'))).toBe('2026-09-30')
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('finds the Monday of a week', () => {
    expect(weekStartMonday('2026-10-01')).toBe('2026-09-28') // Thursday
    expect(weekStartMonday('2026-09-28')).toBe('2026-09-28') // Monday
    expect(weekStartMonday('2026-10-04')).toBe('2026-09-28') // Sunday
  })

  it('gives the calendar date in a time zone', () => {
    const instant = new Date('2026-09-30T22:30:00Z') // 01:30 on 1 Oct in Nairobi
    expect(localDateString(instant, 'Africa/Nairobi')).toBe('2026-10-01')
    expect(localDateString(instant, 'UTC')).toBe('2026-09-30')
  })

  it('counts days between dates', () => {
    expect(daysBetween('2026-09-28', '2026-10-05')).toBe(7)
  })
})
