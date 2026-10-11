import { randomUUID } from 'node:crypto'
import type { EmailJobStatus, EmailJobType } from '@sr/shared'
import { isUniqueViolation } from '../lib/errors'
import type { Db } from '../lib/prisma'

export interface QueueEmail {
  type: EmailJobType
  to: string
  reportId?: number | null
  shiftId?: number | null
  createdById?: number | null
}

const statusFor = (to: string): EmailJobStatus => (to ? 'PENDING' : 'SKIPPED_NO_RECIPIENT')

export async function queueEmail(db: Db, job: QueueEmail): Promise<void> {
  await db.emailJob.create({ data: { ...job, status: statusFor(job.to), dedupeKey: randomUUID() } })
}

/** Queues the job unless one with the same dedupe key exists. Returns whether it was queued. */
export async function queueEmailOnce(db: Db, job: QueueEmail & { dedupeKey: string }): Promise<boolean> {
  try {
    await db.emailJob.create({ data: { ...job, status: statusFor(job.to) } })
    return true
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
}
