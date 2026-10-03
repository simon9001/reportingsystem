import { getCurrentShift } from '../roster/service'
import { publish } from './bus'

type FindKey = (now: Date) => Promise<string | null>

const currentShiftKey: FindKey = async (now) => {
  const s = await getCurrentShift(null, now)
  return s ? `${s.shiftDate}|${s.shiftCode}|${s.shift?.id ?? 'none'}` : null
}

/** Returns a checker that publishes `shift` + `roster` whenever the on-duty shift changes. */
export function createShiftWatcher(find: FindKey = currentShiftKey) {
  let last: string | null | undefined
  return async function check(now = new Date()): Promise<boolean> {
    const key = await find(now)
    const changed = last !== undefined && key !== last
    last = key
    if (changed) publish('shift', 'roster')
    return changed
  }
}

export function startShiftTicker(intervalMs = 30_000): () => void {
  const check = createShiftWatcher()
  const run = () => check().catch((err) => console.error('[shift ticker]', err))
  void run()
  const timer = setInterval(run, intervalMs)
  return () => clearInterval(timer)
}
