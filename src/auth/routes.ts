import { changePasswordSchema, loginSchema, type MeResponse } from '@sr/shared'
import { Hono } from 'hono'
import { writeAudit } from '../audit/audit'
import { AppError } from '../lib/errors'
import { clientIp } from '../lib/http'
import { prisma } from '../lib/prisma'
import { getCurrentShift } from '../roster/service'
import { parseBody } from '../lib/validate'
import type { AppEnv } from '../types'
import { toSessionUser } from '../users/mappers'
import { currentUser, requireAuth } from './middleware'
import { burnPasswordCheck, hashPassword, verifyPassword } from './password'
import { loginLimiter } from './rateLimit'
import { clearSessionCookie, createSession, deleteSession, setSessionCookie } from './session'

export const authRoutes = new Hono<AppEnv>()

authRoutes.post('/login', async (c) => {
  const { email, password } = await parseBody(c, loginSchema)
  if (loginLimiter.isBlocked(email)) {
    throw new AppError('RATE_LIMITED', 'Too many failed attempts. Try again in 15 minutes.')
  }
  const user = await prisma.user.findUnique({ where: { email } })
  const passwordOk = user ? await verifyPassword(user.passwordHash, password) : await burnPasswordCheck(password)
  if (!user || !passwordOk || !user.isActive) {
    loginLimiter.recordFailure(email)
    throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect')
  }
  loginLimiter.reset(email)
  const ip = clientIp(c)
  const { token, updated } = await prisma.$transaction(async (tx) => {
    const session = await createSession(user.id, { ip, userAgent: c.req.header('user-agent') ?? null }, tx)
    const u = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await writeAudit(tx, { userId: user.id, entity: 'User', entityId: user.id, action: 'LOGIN', ip })
    return { token: session.token, updated: u }
  })
  setSessionCookie(c, token)
  return c.json({ user: toSessionUser(updated) })
})

authRoutes.post('/logout', requireAuth({ allowPasswordChange: true }), async (c) => {
  const user = currentUser(c)
  const sessionId = c.get('sessionId')
  if (sessionId) await deleteSession(sessionId)
  await writeAudit(prisma, { userId: user.id, entity: 'User', entityId: user.id, action: 'LOGOUT', ip: clientIp(c) })
  clearSessionCookie(c)
  return c.body(null, 204)
})

authRoutes.get('/me', requireAuth({ allowPasswordChange: true }), async (c) => {
  const user = currentUser(c)
  const body: MeResponse = { user, currentShift: await getCurrentShift(user.id) }
  return c.json(body)
})

authRoutes.post('/change-password', requireAuth({ allowPasswordChange: true }), async (c) => {
  const user = currentUser(c)
  const { currentPassword, newPassword } = await parseBody(c, changePasswordSchema)
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!(await verifyPassword(record.passwordHash, currentPassword))) {
    throw new AppError('VALIDATION_ERROR', 'Current password is incorrect', { currentPassword: 'Current password is incorrect' })
  }
  const passwordHash = await hashPassword(newPassword)
  const sessionId = c.get('sessionId')
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } })
    await tx.session.deleteMany({ where: { userId: user.id, ...(sessionId ? { NOT: { id: sessionId } } : {}) } })
    await writeAudit(tx, { userId: user.id, entity: 'User', entityId: user.id, action: 'UPDATE', after: { passwordChanged: true }, ip: clientIp(c) })
    return u
  })
  return c.json({ user: toSessionUser(updated) })
})
