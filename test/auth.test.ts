import type { MeResponse } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, createUser, login, TEST_PASSWORD } from './factories'

const app = createApp()

describe('auth', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('logs in with a case-insensitive, trimmed email and sets an httpOnly cookie', async () => {
    await createUser('OFFICER', { email: 'antony@kenha.go.ke', fullName: 'Antony Ochieng' })
    const res = await call(app, 'POST', '/api/auth/login', { body: { email: '  Antony@KeNHA.go.ke ', password: TEST_PASSWORD } })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/^sr_session=.+HttpOnly/)
    const body = (await res.json()) as { user: Record<string, unknown> }
    expect(body.user).toMatchObject({ fullName: 'Antony Ochieng', role: 'OFFICER' })
    expect(body.user).not.toHaveProperty('passwordHash')
  })

  it('returns the signed-in user from /me', async () => {
    const u = await createUser('DEPUTY_DIRECTOR')
    const cookie = await login(app, u.email)
    const res = await call(app, 'GET', '/api/auth/me', { cookie })
    const body = (await res.json()) as MeResponse
    expect(res.status).toBe(200)
    expect(body.user.id).toBe(u.id)
  })

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const u = await createUser('OFFICER')
    const wrong = await call(app, 'POST', '/api/auth/login', { body: { email: u.email, password: 'WrongPassword1' } })
    const unknown = await call(app, 'POST', '/api/auth/login', { body: { email: 'nobody@test.local', password: 'WrongPassword1' } })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual(await unknown.json())
  })

  it('refuses inactive users', async () => {
    const u = await createUser('OFFICER', { isActive: false })
    const res = await call(app, 'POST', '/api/auth/login', { body: { email: u.email, password: TEST_PASSWORD } })
    expect(res.status).toBe(401)
  })

  it('blocks the 6th attempt after 5 failures, even with the right password', async () => {
    const u = await createUser('OFFICER')
    for (let i = 0; i < 5; i++) await call(app, 'POST', '/api/auth/login', { body: { email: u.email, password: 'WrongPassword1' } })
    const res = await call(app, 'POST', '/api/auth/login', { body: { email: u.email, password: TEST_PASSWORD } })
    expect(res.status).toBe(429)
  })

  it('requires a session for /me', async () => {
    expect((await call(app, 'GET', '/api/auth/me')).status).toBe(401)
    expect((await call(app, 'GET', '/api/auth/me', { cookie: 'sr_session=forged' })).status).toBe(401)
  })

  it('logs out and invalidates the cookie', async () => {
    const u = await createUser('OFFICER')
    const cookie = await login(app, u.email)
    expect((await call(app, 'POST', '/api/auth/logout', { cookie })).status).toBe(204)
    expect((await call(app, 'GET', '/api/auth/me', { cookie })).status).toBe(401)
  })

  it('rejects expired sessions', async () => {
    const u = await createUser('OFFICER')
    const cookie = await login(app, u.email)
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await call(app, 'GET', '/api/auth/me', { cookie })).status).toBe(401)
  })

  it('changes the password, clears mustChangePassword and signs out other sessions', async () => {
    const u = await createUser('OFFICER', { mustChangePassword: true })
    const cookie = await login(app, u.email)
    const otherDevice = await login(app, u.email)

    const bad = await call(app, 'POST', '/api/auth/change-password', { cookie, body: { currentPassword: 'NotMyPassword1', newPassword: 'BrandNewPass1' } })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { fields: Record<string, string> } }).error.fields.currentPassword).toBeTruthy()

    const ok = await call(app, 'POST', '/api/auth/change-password', { cookie, body: { currentPassword: TEST_PASSWORD, newPassword: 'BrandNewPass1' } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(false)
    expect((await call(app, 'GET', '/api/auth/me', { cookie })).status).toBe(200)
    expect((await call(app, 'GET', '/api/auth/me', { cookie: otherDevice })).status).toBe(401)
    await expect(login(app, u.email, 'BrandNewPass1')).resolves.toMatch(/^sr_session=/)
  })

  it('audits logins without storing secrets', async () => {
    const u = await createUser('OFFICER')
    await login(app, u.email)
    const rows = await prisma.auditLog.findMany({ where: { action: 'LOGIN' } })
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('argon2')
  })
})
