import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { env } from '../lib/env'
import { prisma, type Db } from '../lib/prisma'
import type { SessionUser } from '../types'
import { toSessionUser } from '../users/mappers'

export const SESSION_COOKIE = 'sr_session'
const ttlMs = () => env.SR_SESSION_HOURS * 3_600_000
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(userId: number, meta: { ip: string | null; userAgent: string | null }, db: Db = prisma) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlMs())
  await db.session.create({
    data: { id: hashToken(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  })
  return { token, expiresAt }
}

export async function validateSession(token: string): Promise<{ sessionId: string; user: SessionUser } | null> {
  const id = hashToken(token)
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt <= new Date() || !session.user.isActive) {
    await prisma.session.deleteMany({ where: { id } })
    return null
  }
  // Sliding expiry: extend once less than half the lifetime remains.
  if (session.expiresAt.getTime() - Date.now() < ttlMs() / 2) {
    await prisma.session.updateMany({ where: { id }, data: { expiresAt: new Date(Date.now() + ttlMs()) } })
  }
  return { sessionId: id, user: toSessionUser(session.user) }
}

export async function deleteSession(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } })
}

export async function deleteUserSessions(userId: number, exceptId?: string | null): Promise<void> {
  await prisma.session.deleteMany({ where: { userId, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
}

export function setSessionCookie(c: Context, token: string): void {
  // No Max-Age: the cookie lasts for the browser session; the database enforces the real expiry.
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: env.SR_COOKIE_SECURE, path: '/' })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
