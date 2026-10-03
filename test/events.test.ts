import type { LiveTopic } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { seedDefaults } from '../src/config/seedDefaults'
import { publish, subscribe } from '../src/events/bus'
import { createShiftWatcher } from '../src/events/shiftTicker'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, createUser, loginAs } from './factories'

const app = createApp()

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  while (!text.includes(needle)) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text
}

describe('live updates', () => {
  beforeEach(async () => {
    await resetDb()
    await seedDefaults(prisma)
  })
  afterAll(() => prisma.$disconnect())

  it('delivers published topics to subscribers once per publish', () => {
    const seen: LiveTopic[][] = []
    const off = subscribe((t) => seen.push(t))
    publish('incidents', 'audit', 'incidents')
    off()
    publish('roster')
    expect(seen).toEqual([['incidents', 'audit']])
  })

  it('streams change events to a signed-in client', async () => {
    const { cookie } = await loginAs(app, 'DEPUTY_DIRECTOR')
    const res = await call(app, 'GET', '/api/events', { cookie })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    await readUntil(reader, 'event: ready')
    publish('incidents')
    const text = await readUntil(reader, 'event: change')
    expect(text).toContain('"topics":["incidents"]')
    await reader.cancel()
  })

  it('rejects anonymous clients', async () => {
    expect((await call(app, 'GET', '/api/events')).status).toBe(401)
  })

  it('publishes roster and audit after a roster save', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    const a = await createUser('OFFICER')
    const b = await createUser('OFFICER')
    const seen: LiveTopic[][] = []
    const off = subscribe((t) => seen.push(t))
    await call(app, 'PUT', '/api/roster', { cookie: dd.cookie, body: { entries: [{ shiftDate: '2030-01-07', shiftCode: 'DAY', supervisorId: a.id, officerId: b.id }] } })
    off()
    expect(seen).toContainEqual(['roster', 'audit'])
  })

  it('announces a shift change only when the current shift key changes', async () => {
    const keys = ['2026-09-30|DAY', '2026-09-30|DAY', '2026-09-30|NIGHT']
    const check = createShiftWatcher(async () => keys.shift() ?? null)
    const seen: LiveTopic[][] = []
    const off = subscribe((t) => seen.push(t))
    expect(await check()).toBe(false) // first observation
    expect(await check()).toBe(false)
    expect(await check()).toBe(true)
    off()
    expect(seen).toEqual([['shift', 'roster']])
  })
})
