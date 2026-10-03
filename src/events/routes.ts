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
  return streamSSE(c, async (stream) => {
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
      const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { expiresAt: true } })
      return !!s && s.expiresAt > new Date()
    }

    await stream.writeSSE({ event: 'ready', data: '{}' })
    while (!stream.aborted) {
      if (pending.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, HEARTBEAT_MS)
        })
        wake = null
      }
      if (stream.aborted) break
      if (pending.length > 0) {
        const topics = [...new Set(pending.splice(0))]
        await stream.writeSSE({ event: 'change', data: JSON.stringify({ topics }) })
      } else {
        if (!(await sessionStillValid())) break // signed out or expired: end the stream
        await stream.write(': ping\n\n')
      }
    }
    unsubscribe()
  })
})
