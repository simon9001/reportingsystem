import type { Role } from '@sr/shared'
import type { createApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { prisma } from '../src/lib/prisma'

export const TEST_PASSWORD = 'TestPassword123'
type App = ReturnType<typeof createApp>
let counter = 0
let cachedHash: string | undefined

export async function createUser(
  role: Role,
  overrides: Partial<{ fullName: string; email: string; isActive: boolean; mustChangePassword: boolean }> = {},
) {
  cachedHash ??= await hashPassword(TEST_PASSWORD)
  counter += 1
  return prisma.user.create({
    data: {
      fullName: overrides.fullName ?? `${role} User ${counter}`,
      email: overrides.email ?? `user${counter}@test.local`,
      passwordHash: cachedHash,
      role,
      isActive: overrides.isActive ?? true,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  })
}

export function call(app: App, method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  return app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
}

export async function login(app: App, email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { body: { email, password } })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  return res.headers.get('set-cookie')!.split(';')[0]!
}

export async function loginAs(app: App, role: Role, overrides?: Parameters<typeof createUser>[1]) {
  const user = await createUser(role, overrides)
  const cookie = await login(app, user.email)
  return { user, cookie }
}
