import { Hono } from 'hono'
import { currentUser, requireAuth } from '../auth/middleware'
import { clientIp } from '../lib/http'
import { parseId } from '../lib/validate'
import type { AppEnv } from '../types'
import { deleteAttachment, getAttachmentFile } from './service'

export const attachmentsRoutes = new Hono<AppEnv>()

attachmentsRoutes.get('/:id', requireAuth(), async (c) => {
  const file = await getAttachmentFile(parseId(c))
  const pdf = file.mimeType === 'application/pdf'
  return c.body(new Uint8Array(file.data), 200, {
    'Content-Type': file.mimeType,
    // PDFs download (browser PDF viewers won't render sandboxed documents); images display inline
    'Content-Disposition': `${pdf ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
    ...(pdf ? { 'Content-Security-Policy': "sandbox; default-src 'none'" } : {}),
  })
})

attachmentsRoutes.delete('/:id', requireAuth(), async (c) => {
  await deleteAttachment(currentUser(c), parseId(c), clientIp(c))
  return c.body(null, 204)
})
