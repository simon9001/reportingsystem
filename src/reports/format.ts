const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-10-11' → '11 Oct 2026' (a shift date is a calendar date, not an instant). */
export function fmtShiftDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${d} ${MONTHS[m! - 1]} ${y}`
}

function parts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}

export const fmtTime = (iso: string, tz: string) => parts(iso, tz).time
export function fmtDateTime(iso: string, tz: string): string {
  const p = parts(iso, tz)
  return `${fmtShiftDate(p.date)}, ${p.time}`
}
