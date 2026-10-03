import type { Role } from '@sr/shared'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { AppError } from '../lib/errors'
import type { AppEnv, SessionUser } from '../types'
import { SESSION_COOKIE, validateSession } from './session'

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null)
  c.set('sessionId', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const session = await validateSession(token)
    if (session) {
      c.set('user', session.user)
      c.set('sessionId', session.sessionId)
    }
  }
  await next()
})

function assertSignedIn(c: Context<AppEnv>, allowPasswordChange: boolean): SessionUser {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in')
  if (user.mustChangePassword && !allowPasswordChange) {
    throw new AppError('FORBIDDEN', 'You must change your password before continuing')
  }
  return user
}

export function requireAuth(opts: { allowPasswordChange?: boolean } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    assertSignedIn(c, opts.allowPasswordChange ?? false)
    await next()
  })
}

export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = assertSignedIn(c, false)
    if (!roles.includes(user.role)) throw new AppError('FORBIDDEN', 'You do not have permission to do this')
    await next()
  })
}

export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in')
  return user
}
