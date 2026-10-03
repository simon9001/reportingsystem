import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { sessionMiddleware } from './auth/middleware'
import { authRoutes } from './auth/routes'
import { configRoutes } from './config/routes'
import { errorHandler } from './lib/errors'
import { originCheck } from './lib/http'
import type { AppEnv } from './types'
import { usersRoutes } from './users/routes'

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestId())
  app.onError(errorHandler)
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))

  const api = new Hono<AppEnv>()
  api.use('*', originCheck)
  api.use('*', sessionMiddleware)
  api.get('/health', (c) => c.json({ ok: true }))
  api.route('/auth', authRoutes)
  api.route('/users', usersRoutes)
  api.route('/config', configRoutes)

  app.route('/api', api)
  return app
}
