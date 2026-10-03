import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { errorHandler } from './lib/errors'
import { originCheck } from './lib/http'
import type { AppEnv } from './types'

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestId())
  app.onError(errorHandler)
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))

  const api = new Hono<AppEnv>()
  api.use('*', originCheck)
  api.get('/health', (c) => c.json({ ok: true }))

  app.route('/api', api)
  return app
}
