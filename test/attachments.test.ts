import type { IncidentDto, UploadResultDto } from '@sr/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { assertCanUpload } from '../src/attachments/service'
import type { SessionUser } from '../src/types'
import { call, login, loginAs } from './factories'
import { incidentBody, setupIncidentWorld } from './incidentFixtures'

const app = createApp()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

function upload(id: number, cookie: string, files: { name: string; data: Buffer; type?: string }[]) {
  const form = new FormData()
  for (const f of files) form.append('files', new File([new Uint8Array(f.data)], f.name, { type: f.type ?? 'application/octet-stream' }))
  return app.request(`/api/incidents/${id}/attachments`, { method: 'POST', body: form, headers: { cookie } })
}

describe('incident snapshots', () => {
  let world: Awaited<ReturnType<typeof setupIncidentWorld>>
  let cookie: string
  let incident: IncidentDto

  beforeEach(async () => {
    await resetDb()
    world = await setupIncidentWorld()
    cookie = await login(app, world.supervisor.email)
    incident = (await (await call(app, 'POST', '/api/incidents', { cookie, body: incidentBody(world) })).json()) as IncidentDto
  })
  afterAll(() => prisma.$disconnect())

  it('uploads images and PDFs, detects type from content, and serves them to signed-in users', async () => {
    const res = await upload(incident.id, cookie, [{ name: 'wb04.png', data: PNG }, { name: 'report.pdf', data: PDF }])
    expect(res.status).toBe(201)
    const { attachments } = (await res.json()) as UploadResultDto
    expect(attachments.map((a) => a.mimeType)).toEqual(['image/png', 'application/pdf'])
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    const file = await call(app, 'GET', attachments[0]!.url, { cookie: dd.cookie })
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true)
    expect((await call(app, 'GET', attachments[0]!.url)).status).toBe(401)
    const detail = (await (await call(app, 'GET', `/api/incidents/${incident.id}`, { cookie })).json()) as IncidentDto
    expect(detail.attachmentCount).toBe(2)
    expect(detail.events.map((e) => e.kind)).toContain('ATTACHMENT_ADDED')
  })

  it('rejects a renamed non-image and an oversized file with per-file messages, storing nothing', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)])
    const res = await upload(incident.id, cookie, [
      { name: 'virus.png', data: Buffer.from('MZ this is not an image') },
      { name: 'huge.png', data: big },
      { name: 'ok.png', data: PNG },
    ])
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { fields: Record<string, string> } }
    expect(body.error.fields['virus.png']).toMatch(/JPEG, PNG, WebP or PDF/)
    expect(body.error.fields['huge.png']).toMatch(/10 MB/)
    expect(await prisma.incidentAttachment.count()).toBe(0)
  })

  it('reports a file named __proto__ and rejects a request with no valid file', async () => {
    const res = await upload(incident.id, cookie, [{ name: '__proto__', data: Buffer.from('not an image') }])
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { fields: Record<string, string> } }
    expect(Object.getOwnPropertyNames(body.error.fields)).toContain('__proto__')
  })

  it('checks permission before reading the body, and serves PDFs sandboxed', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    await expect(assertCanUpload({ id: dd.user.id, role: 'DEPUTY_DIRECTOR' } as unknown as SessionUser, incident.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(assertCanUpload({ id: dd.user.id, role: 'DEPUTY_DIRECTOR' } as unknown as SessionUser, 999999)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])
    expect((await upload(incident.id, dd.cookie, [{ name: 'big.png', data: big }])).status).toBe(403)
    const { attachments } = (await (await upload(incident.id, cookie, [{ name: 'r.pdf', data: PDF }])).json()) as UploadResultDto
    const pdf = await call(app, 'GET', attachments[0]!.url, { cookie })
    expect(pdf.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
  })

  it('limits snapshots to 10 per incident', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `s${i}.png`, data: PNG }))
    expect((await upload(incident.id, cookie, eleven)).status).toBe(400)
  })

  it('only lets people who can edit the incident upload, and the uploader or an admin remove', async () => {
    const dd = await loginAs(app, 'DEPUTY_DIRECTOR')
    expect((await upload(incident.id, dd.cookie, [{ name: 'a.png', data: PNG }])).status).toBe(403)
    const { attachments } = (await (await upload(incident.id, cookie, [{ name: 'a.png', data: PNG }])).json()) as UploadResultDto
    expect((await call(app, 'DELETE', `/api/attachments/${attachments[0]!.id}`, { cookie: dd.cookie })).status).toBe(403)
    expect((await call(app, 'DELETE', `/api/attachments/${attachments[0]!.id}`, { cookie })).status).toBe(204)
    expect(await prisma.incidentAttachment.count()).toBe(0)
    expect((await call(app, 'GET', `/api/attachments/${attachments[0]!.id}`, { cookie })).status).toBe(404)
  })
})
