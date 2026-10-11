import { OVERALL_STATUS_LABELS, SEVERITY_LABELS, type ShiftReportDto } from '@sr/shared'
import { fmtDateTime, fmtShiftDate, fmtTime } from '../reports/format'

export interface EmailContent { subject: string; html: string; text: string }
interface Ctx { appBaseUrl: string; timeZone: string }

export const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const link = (r: ShiftReportDto, ctx: Ctx) => `${ctx.appBaseUrl.replace(/\/$/, '')}/reports/${r.id}`
const title = (r: ShiftReportDto) => `${r.content.shift.shiftName} shift report — ${fmtShiftDate(r.content.shift.shiftDate)}`

function layout(heading: string, bodyHtml: string, button?: { href: string; label: string }): string {
  const btn = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:#1c1f24;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f1f2f4;font-family:Segoe UI,Arial,sans-serif;color:#1c1f24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;border-top:4px solid #f5c400">
<tr><td style="padding:24px">
<p style="margin:0 0 4px;font-size:12px;color:#6b7280">KeNHA Control Room</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>
${bodyHtml}${btn}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">This message was sent automatically by the Control Room reporting system.</p>
</td></tr></table></td></tr></table></body></html>`
}

const p = (text: string) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5">${text}</p>`

function figuresLines(r: ShiftReportDto): string[] {
  const f = r.content.figures
  return [
    `Total incidents: ${f.total} (Static ${f.bySide.STATIC} · Mobile ${f.bySide.MOBILE})`,
    `Critical / high: ${f.bySeverity.CRITICAL + f.bySeverity.HIGH}`,
    `Open at shift end: ${f.openAtEnd}`,
    `Escalated on time: ${f.escalation.ON_TIME}`,
  ]
}

export function reportSubmittedEmail(r: ShiftReportDto, ctx: Ctx): EmailContent {
  const when = r.timeliness === 'LATE' ? `Submitted ${r.lateMinutes} min late` : 'Submitted on time'
  const subject = `${title(r)} — ${when}`
  const overall = r.fields.overallStatus ? OVERALL_STATUS_LABELS[r.fields.overallStatus] : 'Not set'
  const by = `${r.submittedBy?.fullName ?? '—'} at ${r.submittedAt ? fmtTime(r.submittedAt, ctx.timeZone) : '—'}`
  const ch = r.content.criticalHigh
  const html = layout(title(r), [
    p(`<strong>${escapeHtml(when)}</strong> by ${escapeHtml(by)} · Overall status: <strong>${escapeHtml(overall)}</strong>`),
    `<ul style="margin:0 0 12px;padding-left:18px;font-size:14px">${figuresLines(r).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
    ch.length
      ? `${p('<strong>Critical and high incidents</strong>')}<ul style="margin:0 0 12px;padding-left:18px;font-size:14px">${ch.map((i) => `<li>${escapeHtml(`${i.ref} · ${SEVERITY_LABELS[i.severity]} · ${i.category} · ${i.place}`)}</li>`).join('')}</ul>`
      : '',
    p('<strong>Shift overview</strong>'),
    p(escapeHtml(r.fields.overview ?? '—').replaceAll('\n', '<br>')),
    p('The full report is attached as a PDF.'),
  ].join(''), { href: link(r, ctx), label: 'Open in Control Room' })
  const text = [
    subject, '', `${when} by ${by}`, `Overall status: ${overall}`, '', ...figuresLines(r), '',
    ...(ch.length ? ['Critical and high incidents:', ...ch.map((i) => `- ${i.ref} · ${SEVERITY_LABELS[i.severity]} · ${i.category} · ${i.place}`), ''] : []),
    'Shift overview:', r.fields.overview ?? '—', '', `Open in Control Room: ${link(r, ctx)}`, 'The full report is attached as a PDF.',
  ].join('\n')
  return { subject, html, text }
}

export function reportOverdueDdEmail(r: ShiftReportDto, ctx: Ctx): EmailContent {
  const subject = `Overdue: ${title(r)} not submitted`
  const due = fmtTime(r.content.deadline, ctx.timeZone)
  const sup = r.content.shift.supervisor.fullName
  const html = layout(`Overdue: ${title(r)}`, [
    p(`The report was due by <strong>${escapeHtml(due)}</strong> and has not been submitted by the Shift Supervisor, <strong>${escapeHtml(sup)}</strong>.`),
    `<ul style="margin:0 0 12px;padding-left:18px;font-size:14px">${figuresLines(r).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
    p('The current draft is attached as a PDF.'),
  ].join(''), { href: link(r, ctx), label: 'Open in Control Room' })
  const text = [subject, '', `Due by ${due}. Shift Supervisor: ${sup}.`, '', ...figuresLines(r), '', `Open in Control Room: ${link(r, ctx)}`, 'The current draft is attached as a PDF.'].join('\n')
  return { subject, html, text }
}

export function reportOverdueSupervisorEmail(r: ShiftReportDto, ctx: Ctx): EmailContent {
  const subject = `Reminder: submit the ${r.content.shift.shiftName} shift report for ${fmtShiftDate(r.content.shift.shiftDate)}`
  const due = fmtTime(r.content.deadline, ctx.timeZone)
  const html = layout('Your shift report is overdue', [
    p(`The ${escapeHtml(title(r))} was due by <strong>${escapeHtml(due)}</strong>. Please complete and submit it now; the Deputy Director has been told it is overdue.`),
  ].join(''), { href: link(r, ctx), label: 'Open the report' })
  const text = [subject, '', `The report was due by ${due}. Please complete and submit it now.`, `Open the report: ${link(r, ctx)}`].join('\n')
  return { subject, html, text }
}

export function testEmail(ctx: { host: string; from: string; sentAt: Date; timeZone: string }): EmailContent {
  const when = fmtDateTime(ctx.sentAt.toISOString(), ctx.timeZone)
  const lines = ['SMTP is working.', `Sent at: ${when}`, `Server: ${ctx.host}`, `From: ${ctx.from}`]
  return { subject: 'Control Room test email', html: layout('Test email', lines.map((l) => p(escapeHtml(l))).join('')), text: lines.join('\n') }
}
