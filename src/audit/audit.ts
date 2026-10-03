import type { AuditAction } from '@sr/shared'
import type { Db } from '../lib/prisma'

export interface AuditEntry {
  userId: number | null
  entity: string
  entityId?: string | number | null
  action: AuditAction
  before?: unknown
  after?: unknown
  ip?: string | null
}

const toJson = (v: unknown) => (v === undefined ? null : JSON.stringify(v))

/** Callers must never pass password hashes or session tokens in before/after. */
export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: e.userId,
      entity: e.entity,
      entityId: e.entityId == null ? null : String(e.entityId),
      action: e.action,
      beforeJson: toJson(e.before),
      afterJson: toJson(e.after),
      ip: e.ip ?? null,
    },
  })
}
