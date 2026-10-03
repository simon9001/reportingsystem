import { addDays, auditQuerySchema, type AuditAction, type AuditLogDto, type Paged } from '@sr/shared'
import { Hono } from 'hono'
import { requireRole } from '../auth/middleware'
import type { AuditLog, Prisma, User } from '../generated/prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { localTime } from '../lib/shiftTime'
import { parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'

const PAGE_SIZE = 50

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toAuditLogDto(row: AuditLog & { user: User | null }): AuditLogDto {
  return {
    id: row.id,
    at: row.at.toISOString(),
    user: row.user ? { id: row.user.id, fullName: row.user.fullName } : null,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action as AuditAction,
    before: parseJson(row.beforeJson),
    after: parseJson(row.afterJson),
    ip: row.ip,
  }
}

export const auditRoutes = new Hono<AppEnv>()

auditRoutes.get('/', requireRole('ADMIN'), async (c) => {
  const q = parseQuery(c, auditQuerySchema)
  const tz = env.SR_APP_TIMEZONE
  const at: Prisma.DateTimeFilter = {}
  if (q.from) at.gte = localTime(q.from, '00:00', tz)
  if (q.to) at.lt = localTime(addDays(q.to, 1), '00:00', tz)
  const where: Prisma.AuditLogWhereInput = {
    entity: q.entity,
    entityId: q.entityId,
    userId: q.userId,
    ...(q.from || q.to ? { at } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { user: true }, orderBy: { id: 'desc' }, skip: (q.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ])
  const body: Paged<AuditLogDto> = { items: rows.map(toAuditLogDto), total, page: q.page, pageSize: PAGE_SIZE }
  return c.json(body)
})
