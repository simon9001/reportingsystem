import type { LiveTopic } from '@sr/shared'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { requireAuth } from '../auth/middleware'
import { prisma } from '../lib/prisma'
import type { AppEnv } from '../types'
import { subscribe } from './bus'

const HEARTBEAT_MS = 25_000

export const eventsRoutes = new Hono<AppEnv>()

eventsRoutes.get('/', requireAuth({ allowPasswordChange: true }), (c) => {
  const sessionId = c.get('sessionId')
  const res = streamSSE(c, async (stream) => {
    const pending: LiveTopic[] = []
    let wake: (() => void) | null = null
    const unsubscribe = subscribe((topics) => {
      pending.push(...topics)
      wake?.()
    })
    stream.onAbort(() => {
      unsubscribe()
      wake?.()
    })

    const sessionStillValid = async () => {
      if (!sessionId) return false
      try {
        const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { expiresAt: true } })
        return !!s && s.expiresAt > new Date()
      } catch {
        return false // cannot confirm the session: end the stream, the client reconnects
      }
    }

    try {
      await stream.writeSSE({ event: 'ready', data: '{}' })
      while (!stream.aborted) {
        if (pending.length === 0) {
          let timer: ReturnType<typeof setTimeout> | undefined
          await new Promise<void>((resolve) => {
            wake = resolve
            timer = setTimeout(resolve, HEARTBEAT_MS)
          })
          clearTimeout(timer)
          wake = null
        }
        if (stream.aborted) break
        if (!(await sessionStillValid())) break // signed out, expired or deactivated: end the stream
        if (pending.length > 0) {
          const topics = [...new Set(pending.splice(0))]
          await stream.writeSSE({ event: 'change', data: JSON.stringify({ topics }) })
        } else {
          await stream.write(': ping\n\n')
        }
      }
    } finally {
      unsubscribe()
    }
  })
  // Keep reverse proxies (IIS ARR, nginx) and compression from buffering the stream; streamSSE only sets no-cache.
  res.headers.set('Cache-Control', 'no-cache, no-transform')
  res.headers.set('X-Accel-Buffering', 'no')
  return res
})
