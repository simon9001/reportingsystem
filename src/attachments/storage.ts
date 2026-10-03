import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ATTACHMENT_MIME_TYPES } from '@sr/shared'
import { fileTypeFromBuffer } from 'file-type'
import { env } from '../lib/env'

const EXT: Record<(typeof ATTACHMENT_MIME_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/** Detects the real type from the file's bytes. Returns null when it is not an allowed type. */
export async function detectAllowedType(buf: Buffer): Promise<{ mime: (typeof ATTACHMENT_MIME_TYPES)[number]; ext: string } | null> {
  const t = await fileTypeFromBuffer(buf)
  if (!t || !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(t.mime)) return null
  const mime = t.mime as (typeof ATTACHMENT_MIME_TYPES)[number]
  return { mime, ext: EXT[mime] }
}

const root = () => path.resolve(env.SR_UPLOAD_DIR)

/** Stores under <root>/<yyyy>/<mm>/<uuid>.<ext>; returns the relative stored name (forward slashes). */
export async function saveFile(buf: Buffer, ext: string, now = new Date()): Promise<string> {
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const storedName = `${yyyy}/${mm}/${randomUUID()}.${ext}`
  await mkdir(path.join(root(), yyyy, mm), { recursive: true })
  await writeFile(path.join(root(), storedName), buf)
  return storedName
}

function safePath(storedName: string): string {
  const full = path.resolve(root(), storedName)
  if (!full.startsWith(root() + path.sep)) throw new Error('Invalid stored file name')
  return full
}

export const readStoredFile = (storedName: string) => readFile(safePath(storedName))
export const removeStoredFile = (storedName: string) => rm(safePath(storedName), { force: true })
