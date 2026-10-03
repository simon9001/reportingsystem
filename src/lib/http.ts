import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'
import { env } from './env'
import { AppError } from './errors'

export function clientIp(c: Context): string | null {
  const forwarded = c.req.header('x-forwarded-for')
  return forwarded ? forwarded.split(',')[0]!.trim() : null
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** CSRF defence on top of SameSite cookies: same-origin requests only, JSON or multipart bodies only. */
export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(env.SR_APP_BASE_URL).origin && origin !== new URL(c.req.url).origin) {
      throw new AppError('FORBIDDEN', 'Request origin not allowed')
    }
    const type = c.req.header('content-type') ?? ''
    const hasBody = type !== '' || (c.req.header('content-length') ?? '0') !== '0'
    if (hasBody && !type.startsWith('application/json') && !type.startsWith('multipart/form-data')) {
      throw new AppError('VALIDATION_ERROR', 'Unsupported content type')
    }
  }
  await next()
})
