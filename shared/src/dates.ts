/** Dates are exchanged as "YYYY-MM-DD" strings; a Date at UTC midnight represents one in memory. */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function fromDateString(s: string): Date {
  return new Date(`${s}T00:00:00Z`)
}

export function addDays(s: string, n: number): string {
  const d = fromDateString(s)
  d.setUTCDate(d.getUTCDate() + n)
  return toDateString(d)
}

/** Calendar date of an instant as seen in the given IANA time zone. */
export function localDateString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

export function weekStartMonday(s: string): string {
  const dayOfWeek = fromDateString(s).getUTCDay() // 0 = Sunday
  return addDays(s, -((dayOfWeek + 6) % 7))
}

export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateString(to).getTime() - fromDateString(from).getTime()) / 86_400_000)
}
