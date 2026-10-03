import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requestId } from 'hono/request-id'
import { attachmentsRoutes } from './attachments/routes'
import { sessionMiddleware } from './auth/middleware'
import { authRoutes } from './auth/routes'
import { auditRoutes } from './audit/routes'
import { configRoutes } from './config/routes'
import { eventsRoutes } from './events/routes'
import { incidentsRoutes } from './incidents/routes'
import { errorHandler } from './lib/errors'
import { originCheck } from './lib/http'
import { rosterRoutes } from './roster/routes'
import type { AppEnv } from './types'
import { usersRoutes } from './users/routes'

export function createApp() {
  const app = new Hono<AppEnv>()
  app.use('*', requestId())
  app.onError(errorHandler)
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404))

  const api = new Hono<AppEnv>()
  const jsonLimit = bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) => c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large' } }, 413),
  })
  const uploadLimit = bodyLimit({
    maxSize: 110 * 1024 * 1024, // 10 files × 10 MB plus multipart overhead
    onError: (c) => c.json({ error: { code: 'VALIDATION_ERROR', message: 'Upload is too large' } }, 413),
  })
  const UPLOAD_PATH = /\/incidents\/\d+\/attachments$/
  api.use('*', (c, next) => (c.req.method === 'POST' && UPLOAD_PATH.test(c.req.path) ? uploadLimit(c, next) : jsonLimit(c, next)))
  api.use('*', originCheck)
  api.use('*', sessionMiddleware)
  api.get('/health', (c) => c.json({ ok: true }))
  api.route('/auth', authRoutes)
  api.route('/users', usersRoutes)
  api.route('/config', configRoutes)
  api.route('/roster', rosterRoutes)
  api.route('/audit', auditRoutes)
  api.route('/incidents', incidentsRoutes)
  api.route('/events', eventsRoutes)
  api.route('/attachments', attachmentsRoutes)

  app.route('/api', api)
  return app
}
