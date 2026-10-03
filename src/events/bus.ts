import { EventEmitter } from 'node:events'
import type { LiveTopic } from '@sr/shared'

const emitter = new EventEmitter()
emitter.setMaxListeners(0) // one listener per open browser tab

/** Call only after the change is committed. Payloads carry topic names, never data. */
export function publish(...topics: LiveTopic[]): void {
  const unique = [...new Set(topics)]
  if (unique.length > 0) emitter.emit('change', unique)
}

export function subscribe(fn: (topics: LiveTopic[]) => void): () => void {
  emitter.on('change', fn)
  return () => emitter.off('change', fn)
}
