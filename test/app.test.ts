import { Hono } from 'hono'
import { z } from 'zod'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { AppError, errorHandler } from '../src/lib/errors'
import { clientIp } from '../src/lib/http'
import { prisma } from '../src/lib/prisma'
import { parseBody } from '../src/lib/validate'

afterAll(() => prisma.$disconnect())

describe('app skeleton', () => {
  it('answers the health check', async () => {
    const res = await createApp().request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns JSON 404 for unknown routes', async () => {
    const res = await createApp().request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } })
  })

  it('rejects writes from a foreign origin', async () => {
    const res = await createApp().request('/api/health', { method: 'POST', headers: { origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })

  it('rejects bodies that are not JSON or multipart', async () => {
    const res = await createApp().request('/api/health', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })
    expect(res.status).toBe(400)
  })

  it('rejects oversized request bodies with 413', async () => {
    const body = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200 * 1024) })
    const res = await createApp().request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large' } })
  })

  it('hides unexpected errors behind a request id', async () => {
    const app = createApp()
    app.get('/boom', () => { throw new Error('secret detail') })
    const res = await app.request('/boom')
    const body = (await res.json()) as { error: { code: string; message: string; requestId: string } }
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL')
    expect(body.error.message).not.toContain('secret')
    expect(body.error.requestId).toBeTruthy()
  })
})

describe('validation helpers', () => {
  const app = new Hono()
  app.onError(errorHandler)
  app.post('/x', async (c) => c.json(await parseBody(c, z.object({ name: z.string().min(2, 'Too short') }))))
  app.get('/conflict', () => { throw new AppError('CONFLICT', 'Already exists', { email: 'Taken' }) })

  it('returns field errors for invalid bodies', async () => {
    const res = await app.request('/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'a' }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', fields: { name: 'Too short' } } })
  })

  it('rejects malformed JSON', async () => {
    const res = await app.request('/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })
    expect(res.status).toBe(400)
  })

  it('maps AppError codes to HTTP status', async () => {
    const res = await app.request('/conflict')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: { code: 'CONFLICT', message: 'Already exists', fields: { email: 'Taken' } } })
  })
})

describe('clientIp', () => {
  it('ignores X-Forwarded-For unless SR_TRUST_PROXY is enabled', async () => {
    const app = new Hono()
    app.get('/ip', (c) => c.json({ ip: clientIp(c) }))
    const res = await app.request('/ip', { headers: { 'x-forwarded-for': '6.6.6.6' } })
    expect(await res.json()).toEqual({ ip: null })
  })
})
