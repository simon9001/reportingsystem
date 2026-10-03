import { describe, expect, it } from 'vitest'
import { coverageProblem, crossesMidnight, localTime, resolveShift, shiftWindow } from '../src/lib/shiftTime'

const TZ = 'Africa/Nairobi' // UTC+3, no daylight saving
const DAY = { code: 'DAY', startTime: '08:00', endTime: '17:00' }
const NIGHT = { code: 'NIGHT', startTime: '17:00', endTime: '08:00' }
const DEFS = [DAY, NIGHT]
/** Builds an instant from a Nairobi wall-clock time. */
const nairobi = (isoLocal: string) => new Date(`${isoLocal}+03:00`)

describe('shiftWindow', () => {
  it('computes the Day shift window', () => {
    const w = shiftWindow('2026-09-30', DAY, TZ)
    expect(w.startsAt.toISOString()).toBe('2026-09-30T05:00:00.000Z')
    expect(w.endsAt.toISOString()).toBe('2026-09-30T14:00:00.000Z')
  })

  it('ends the Night shift on the next calendar day', () => {
    const w = shiftWindow('2026-09-30', NIGHT, TZ)
    expect(w.startsAt.toISOString()).toBe('2026-09-30T14:00:00.000Z')
    expect(w.endsAt.toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })

  it('handles the year end', () => {
    expect(shiftWindow('2026-12-31', NIGHT, TZ).endsAt.toISOString()).toBe('2027-01-01T05:00:00.000Z')
  })

  it('depends only on the tz argument, not the server time zone', () => {
    expect(shiftWindow('2026-09-30', DAY, 'UTC').startsAt.toISOString()).toBe('2026-09-30T08:00:00.000Z')
    expect(localTime('2026-09-30', '00:00', TZ).toISOString()).toBe('2026-09-29T21:00:00.000Z')
  })
})

describe('resolveShift', () => {
  it.each([
    ['2026-09-30T08:00:00', 'DAY', '2026-09-30'],
    ['2026-09-30T16:59:59', 'DAY', '2026-09-30'],
    ['2026-09-30T17:00:00', 'NIGHT', '2026-09-30'],
    ['2026-09-30T23:30:00', 'NIGHT', '2026-09-30'],
    ['2026-10-01T02:00:00', 'NIGHT', '2026-09-30'], // after midnight belongs to the shift that started the day before
    ['2026-10-01T07:59:59', 'NIGHT', '2026-09-30'],
    ['2026-10-01T08:00:00', 'DAY', '2026-10-01'],
  ])('%s belongs to the %s shift of %s', (local, code, shiftDate) => {
    const r = resolveShift(nairobi(local), DEFS, TZ)
    expect(r?.definition.code).toBe(code)
    expect(r?.shiftDate).toBe(shiftDate)
  })

  it('works for the three-shift pattern in the user manual', () => {
    const defs = [
      { code: 'MORNING', startTime: '06:00', endTime: '14:00' },
      { code: 'EVENING', startTime: '14:00', endTime: '22:00' },
      { code: 'NIGHT', startTime: '22:00', endTime: '06:00' },
    ]
    const r = resolveShift(nairobi('2026-09-29T01:15:00'), defs, TZ)
    expect(r?.definition.code).toBe('NIGHT')
    expect(r?.shiftDate).toBe('2026-09-28')
  })

  it('returns null when there are no definitions', () => {
    expect(resolveShift(new Date(), [], TZ)).toBeNull()
  })
})

describe('coverage', () => {
  it('detects midnight crossing', () => {
    expect(crossesMidnight(NIGHT)).toBe(true)
    expect(crossesMidnight(DAY)).toBe(false)
  })

  it('accepts shifts that cover the day exactly once', () => {
    expect(coverageProblem(DEFS)).toBeNull()
  })

  it('reports a gap', () => {
    expect(coverageProblem([DAY, { startTime: '18:00', endTime: '08:00' }])).toBe('No shift covers 17:00')
  })

  it('reports an overlap', () => {
    expect(coverageProblem([DAY, { startTime: '16:00', endTime: '08:00' }])).toBe('More than one shift covers 16:00')
  })
})
