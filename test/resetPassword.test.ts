import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { generateTempPassword, resetPasswordByEmail } from '../src/users/resetPassword'
import { resetDb } from './db'
import { call, createUser, login } from './factories'

const app = createApp()

beforeEach(() => resetDb())
afterAll(() => prisma.$disconnect())

describe('command-line password reset', () => {
  it('sets a new password, forces a change, signs the user out everywhere and audits it', async () => {
    const admin = await createUser('ADMIN', { email: 'admin@kenha.test' })
    const oldCookie = await login(app, admin.email)
    const r = await resetPasswordByEmail('  ADMIN@Kenha.TEST ', 'MyTemp2026!')
    expect(r).toMatchObject({ email: 'admin@kenha.test', password: 'MyTemp2026!', generated: false, reactivated: false })
    expect((await call(app, 'GET', '/api/auth/me', { cookie: oldCookie })).status).toBe(401)
    expect((await call(app, 'POST', '/api/auth/login', { body: { email: admin.email, password: 'TestPassword123' } })).status).toBe(401)
    expect((await call(app, 'POST', '/api/auth/login', { body: { email: admin.email, password: 'MyTemp2026!' } })).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).mustChangePassword).toBe(true)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'User', entityId: String(admin.id), action: 'UPDATE' } })
    expect(audit.userId).toBeNull()
    expect(JSON.parse(audit.afterJson!)).toEqual({ passwordReset: true, via: 'command line' })
  })

  it('generates a strong temporary password when none is given and reactivates the account', async () => {
    const u = await createUser('OFFICER', { email: 'off@kenha.test', isActive: false })
    const r = await resetPasswordByEmail('off@kenha.test')
    expect(r.generated).toBe(true)
    expect(r.reactivated).toBe(true)
    expect(r.password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(true)
    expect((await call(app, 'POST', '/api/auth/login', { body: { email: u.email, password: r.password } })).status).toBe(200)
  })

  it('changes nothing for an unknown email or a too-short password', async () => {
    const admin = await createUser('ADMIN', { email: 'admin@kenha.test' })
    await expect(resetPasswordByEmail('nobody@kenha.test')).rejects.toThrow('No user with that email')
    await expect(resetPasswordByEmail('admin@kenha.test', 'short')).rejects.toThrow('Password must be at least 10 characters')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(admin.passwordHash)
    expect(await prisma.auditLog.count()).toBe(0)
  })

  it('makes different random passwords', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword())
  })
})
