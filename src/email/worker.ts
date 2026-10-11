import type { EmailJobType } from '@sr/shared'
import { getSettings } from '../config/settings'
import { publish } from '../events/bus'
import type { EmailJob } from '../generated/prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { renderReportPdf, reportPdfFileName } from '../reports/pdf'
import { ensureDraft, loadReportDto } from '../reports/service'
import { ensureSubmittedPdf } from '../reports/storage'
import { queueEmailOnce } from './queue'
import { reportOverdueDdEmail, reportOverdueSupervisorEmail, reportSubmittedEmail, testEmail } from './templates'
import { getMailer, smtpStatus, type MailMessage, type Mailer } from './transport'

export const BACKOFF_MINUTES = [1, 5, 15, 60]
export const MAX_ATTEMPTS = 5
const STALE_LOCK_MS = 10 * 60_000
const BATCH = 5
const OVERDUE_TYPES: readonly string[] = ['REPORT_OVERDUE_DD', 'REPORT_OVERDUE_SUPERVISOR']

/** An overdue reminder is no longer needed once its report has been submitted. */
export async function isReminderForSubmittedReport(job: Pick<EmailJob, 'type' | 'reportId'>): Promise<boolean> {
  if (!OVERDUE_TYPES.includes(job.type) || job.reportId === null) return false
  const report = await prisma.shiftReport.findUnique({ where: { id: job.reportId }, select: { status: true } })
  return report?.status === 'SUBMITTED'
}

/** Minutes to wait after the Nth failed attempt; null once attempts are exhausted. */
export function nextAttemptDelayMinutes(attemptsAfterFailure: number): number | null {
  return attemptsAfterFailure >= MAX_ATTEMPTS ? null : BACKOFF_MINUTES[attemptsAfterFailure - 1]!
}

/** Atomically moves due jobs to SENDING; READPAST makes a second runner skip rows the first one holds. */
async function claimJobs(now: Date): Promise<number[]> {
  const stale = new Date(now.getTime() - STALE_LOCK_MS)
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    UPDATE TOP (${BATCH}) [dbo].[EmailJob] WITH (UPDLOCK, READPAST, ROWLOCK)
    SET [status] = 'SENDING', [lockedAt] = ${now}
    OUTPUT inserted.[id] AS id
    WHERE ([status] = 'PENDING' AND [nextAttemptAt] <= ${now}) OR ([status] = 'SENDING' AND [lockedAt] < ${stale});`
  return rows.map((r) => r.id)
}

/** Error text without credentials (user, pass or auth fragments). */
const cleanError = (err: unknown) =>
  String(err instanceof Error ? err.message : err).replace(/(user|pass|password|auth)\s*[=:]\s*\S+/gi, '$1=***').slice(0, 1000)

async function buildMessage(job: EmailJob): Promise<MailMessage> {
  const ctx = { appBaseUrl: env.SR_APP_BASE_URL, timeZone: env.SR_APP_TIMEZONE }
  const type = job.type as EmailJobType
  if (type === 'TEST') {
    const s = smtpStatus()
    return { to: job.to, ...testEmail({ host: s.host ?? '—', from: s.from ?? '—', sentAt: new Date(), timeZone: ctx.timeZone }) }
  }
  const report = await loadReportDto(job.reportId!)
  if (type === 'REPORT_SUBMITTED') {
    const pdf = await ensureSubmittedPdf(report.id)
    return { to: job.to, ...reportSubmittedEmail(report, ctx), attachments: [{ filename: reportPdfFileName(report), content: pdf, contentType: 'application/pdf' }] }
  }
  if (type === 'REPORT_OVERDUE_DD') {
    const pdf = await renderReportPdf(report, { draft: true, generatedAt: new Date(), timeZone: ctx.timeZone })
    return { to: job.to, ...reportOverdueDdEmail(report, ctx), attachments: [{ filename: `DRAFT-${reportPdfFileName(report)}`, content: pdf, contentType: 'application/pdf' }] }
  }
  return { to: job.to, ...reportOverdueSupervisorEmail(report, ctx) }
}

export async function runEmailJobs(now = new Date(), mailer: Mailer | null = getMailer()) {
  const result = { sent: 0, failed: 0, skipped: 0 }
  const ids = await claimJobs(now)
  for (const id of ids) {
    const job = await prisma.emailJob.findUniqueOrThrow({ where: { id } })
    if (await isReminderForSubmittedReport(job)) {
      await prisma.emailJob.update({ where: { id }, data: { status: 'SKIPPED_SUBMITTED', lockedAt: null } })
      result.skipped += 1
      continue
    }
    if (!mailer) {
      await prisma.emailJob.update({ where: { id }, data: { status: 'SKIPPED_NO_SMTP', lockedAt: null } })
      result.skipped += 1
      continue
    }
    try {
      await mailer.send(await buildMessage(job))
      await prisma.emailJob.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), lockedAt: null, lastError: null } })
      result.sent += 1
    } catch (err) {
      const attempts = job.attempts + 1
      const delay = nextAttemptDelayMinutes(attempts)
      await prisma.emailJob.update({
        where: { id },
        data: {
          attempts, lastError: cleanError(err), lockedAt: null,
          ...(delay === null ? { status: 'FAILED' } : { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + delay * 60_000) }),
        },
      })
      result.failed += 1
    }
  }
  return result
}

/** Queues the overdue emails (DD with draft PDF, supervisor reminder) once per shift, for deadlines in the last 24 hours. */
export async function queueOverdueReports(now = new Date()): Promise<number> {
  const { reportDeadlineMinutes, ddEmails } = await getSettings()
  const deadlineMs = reportDeadlineMinutes * 60_000
  const shifts = await prisma.shift.findMany({
    where: {
      endsAt: { lte: new Date(now.getTime() - deadlineMs), gt: new Date(now.getTime() - deadlineMs - 24 * 3_600_000) },
      OR: [{ report: { is: null } }, { report: { is: { status: 'DRAFT' } } }],
    },
    include: { supervisor: true },
  })
  let queued = 0
  for (const s of shifts) {
    try {
      const { id: reportId } = await ensureDraft(prisma, s.id)
      for (const to of ddEmails) {
        if (await queueEmailOnce(prisma, { type: 'REPORT_OVERDUE_DD', to, reportId, shiftId: s.id, dedupeKey: `OVERDUE_DD:${s.id}:${to.toLowerCase()}` })) queued += 1
      }
      if (await queueEmailOnce(prisma, { type: 'REPORT_OVERDUE_SUPERVISOR', to: s.supervisor.email, reportId, shiftId: s.id, dedupeKey: `OVERDUE_SUP:${s.id}` })) queued += 1
    } catch (err) {
      console.error('[overdue check] shift', s.id, err) // one bad shift must not stop the others
    }
  }
  if (queued > 0) publish('reports')
  return queued
}

/** Runs both loops on timers; each loop never overlaps itself. Returns a stop function. */
export function startEmailWorker(): () => void {
  let sending = false
  let checking = false
  const send = async () => {
    if (sending) return
    sending = true
    try { await runEmailJobs() } catch (err) { console.error('[email worker]', err) } finally { sending = false }
  }
  const check = async () => {
    if (checking) return
    checking = true
    try { await queueOverdueReports() } catch (err) { console.error('[overdue check]', err) } finally { checking = false }
  }
  const a = setInterval(send, 30_000)
  const b = setInterval(check, 60_000)
  a.unref()
  b.unref()
  void check().then(send)
  return () => { clearInterval(a); clearInterval(b) }
}
