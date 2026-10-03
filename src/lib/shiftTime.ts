import { TZDate } from '@date-fns/tz'
import { addDays, localDateString } from '@sr/shared'

export interface ShiftTimes { code: string; startTime: string; endTime: string }
export interface ShiftWindow { startsAt: Date; endsAt: Date }
type Times = Pick<ShiftTimes, 'startTime' | 'endTime'>

export function minutesOfDay(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) throw new Error(`Invalid time "${hhmm}"`)
  return Number(m[1]) * 60 + Number(m[2])
}

export function crossesMidnight(def: Times): boolean {
  return minutesOfDay(def.endTime) <= minutesOfDay(def.startTime)
}

/** The instant at which the wall clock in `tz` shows `hhmm` on `dateStr`. */
export function localTime(dateStr: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const minutes = minutesOfDay(hhmm)
  return new Date(new TZDate(y!, mo! - 1, d!, Math.floor(minutes / 60), minutes % 60, tz).getTime())
}

export function shiftWindow(shiftDate: string, def: Times, tz: string): ShiftWindow {
  const endDate = crossesMidnight(def) ? addDays(shiftDate, 1) : shiftDate
  return { startsAt: localTime(shiftDate, def.startTime, tz), endsAt: localTime(endDate, def.endTime, tz) }
}

/** Finds the shift (and its start date) that contains `instant`. A shift that crosses midnight belongs to the date it started. */
export function resolveShift<T extends ShiftTimes>(
  instant: Date,
  defs: readonly T[],
  tz: string,
): (ShiftWindow & { shiftDate: string; definition: T }) | null {
  const today = localDateString(instant, tz)
  for (const shiftDate of [today, addDays(today, -1)]) {
    for (const definition of defs) {
      const w = shiftWindow(shiftDate, definition, tz)
      if (instant >= w.startsAt && instant < w.endsAt) return { shiftDate, definition, ...w }
    }
  }
  return null
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Null when the shifts cover every minute of the day exactly once; otherwise a human-readable problem. */
export function coverageProblem(defs: readonly Times[]): string | null {
  const covered = new Array<number>(1440).fill(0)
  for (const def of defs) {
    const start = minutesOfDay(def.startTime)
    const end = minutesOfDay(def.endTime)
    const length = crossesMidnight(def) ? 1440 - start + end : end - start
    for (let i = 0; i < length; i++) covered[(start + i) % 1440]! += 1
  }
  const gap = covered.indexOf(0)
  if (gap >= 0) return `No shift covers ${fmt(gap)}`
  const overlap = covered.findIndex((n) => n > 1)
  if (overlap >= 0) return `More than one shift covers ${fmt(overlap)}`
  return null
}
