import path from 'node:path'
import {
  ESCALATION_RESULT_LABELS, INCIDENT_SIDE_SHORT, INCIDENT_STATUS_LABELS, OVERALL_STATUS_LABELS, REPORT_CONFIRMATIONS, REPORT_TEXT_FIELDS,
  REPORT_TEXT_LABELS, SEVERITIES, SEVERITY_LABELS, type ReportIncidentRowDto, type ShiftReportDto,
} from '@sr/shared'
import PDFDocument from 'pdfkit'
import { fmtDateTime, fmtShiftDate, fmtTime } from './format'

const LOGO = path.resolve(import.meta.dirname, '../../assets/kenha-logo.png')
const INK = '#1c1f24'
const MUTED = '#6b7280'
const LINE = '#e4e6ea'
const HEAD_BG = '#f1f2f4'
const M = 40 // page margin

export const reportPdfFileName = (r: ShiftReportDto) => `Shift-report-${r.content.shift.shiftDate}-${r.content.shift.shiftCode}.pdf`

interface Col<T> { header: string; width: number; value: (row: T) => string }
type Doc = PDFKit.PDFDocument

function ensureSpace(doc: Doc, height: number) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage()
}

function heading(doc: Doc, text: string) {
  ensureSpace(doc, 40)
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).fillColor(INK).text(text, M, doc.y)
  doc.moveDown(0.2)
}

/** Simple table: header row repeats on each new page, cells wrap. */
function table<T>(doc: Doc, cols: Col<T>[], rows: T[], empty: string) {
  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(empty, M, doc.y)
    return
  }
  const pad = 4
  const drawHeader = () => {
    const y = doc.y
    doc.rect(M, y, cols.reduce((s, c) => s + c.width, 0), 18).fill(HEAD_BG)
    let x = M
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
    for (const c of cols) { doc.text(c.header, x + pad, y + 5, { width: c.width - pad * 2, lineBreak: false }); x += c.width }
    doc.y = y + 18
  }
  ensureSpace(doc, 40)
  drawHeader()
  doc.font('Helvetica').fontSize(8.5).fillColor(INK)
  for (const r of rows) {
    const h = Math.max(...cols.map((c) => doc.heightOfString(c.value(r) || '—', { width: c.width - pad * 2 }))) + pad * 2
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); doc.font('Helvetica').fontSize(8.5).fillColor(INK) }
    const y = doc.y
    let x = M
    for (const c of cols) { doc.text(c.value(r) || '—', x + pad, y + pad, { width: c.width - pad * 2 }); x += c.width }
    doc.moveTo(M, y + h).lineTo(M + cols.reduce((s, c) => s + c.width, 0), y + h).strokeColor(LINE).lineWidth(0.5).stroke()
    doc.y = y + h
  }
}

function incidentCols(tz: string): Col<ReportIncidentRowDto>[] {
  return [
    { header: 'ID', width: 70, value: (r) => r.ref },
    { header: 'Time', width: 42, value: (r) => fmtTime(r.occurredAt, tz) },
    { header: 'Side', width: 42, value: (r) => INCIDENT_SIDE_SHORT[r.side] },
    { header: 'Place / unit', width: 130, value: (r) => r.place },
    { header: 'Category', width: 80, value: (r) => r.category },
    { header: 'Severity', width: 50, value: (r) => SEVERITY_LABELS[r.severity] },
    { header: 'Status', width: 50, value: (r) => INCIDENT_STATUS_LABELS[r.status] },
    { header: 'Escalation', width: 51, value: (r) => ESCALATION_RESULT_LABELS[r.escalationResult] },
  ]
}

export function renderReportPdf(report: ShiftReportDto, opts: { draft: boolean; generatedAt: Date; timeZone: string; compress?: boolean }): Promise<Buffer> {
  const { content: c, fields: f } = report
  const tz = opts.timeZone
  const doc = new PDFDocument({
    size: 'A4', margins: { top: M, bottom: M + 14, left: M, right: M }, bufferPages: true, compress: opts.compress ?? true,
    info: { Title: `${c.shift.shiftName} shift report — ${fmtShiftDate(c.shift.shiftDate)}`, Author: 'KeNHA Control Room' },
  })
  const chunks: Buffer[] = []
  doc.on('data', (b: Buffer) => chunks.push(b))
  const done = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject) })
  const width = doc.page.width - M * 2

  // Header
  doc.image(LOGO, M, M, { height: 40 })
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('Control Room Shift Report', M + 60, M + 2)
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`${c.shift.shiftName} shift · ${fmtShiftDate(c.shift.shiftDate)} · ${fmtTime(c.shift.startsAt, tz)}–${fmtTime(c.shift.endsAt, tz)}`, M + 60, doc.y + 2)
  doc.text(`Shift Supervisor: ${c.shift.supervisor.fullName} · Control Room Officer: ${c.shift.officer.fullName}`, M + 60)
  doc.y = M + 52
  doc.moveTo(M, doc.y).lineTo(M + width, doc.y).strokeColor('#f5c400').lineWidth(2).stroke()
  doc.moveDown(0.6)

  const status = report.status === 'SUBMITTED'
    ? `SUBMITTED ${report.submittedAt ? fmtDateTime(report.submittedAt, tz) : ''} by ${report.submittedBy?.fullName ?? '—'} · ${report.timeliness === 'LATE' ? `${report.lateMinutes} min late` : 'On time'}`
    : `DRAFT · due by ${fmtDateTime(c.deadline, tz)}`
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Status: ${status}`, M, doc.y)
  doc.font('Helvetica').text(`Overall status: ${f.overallStatus ? OVERALL_STATUS_LABELS[f.overallStatus] : 'Not set'}`)

  // Figures
  heading(doc, 'Figures')
  const fig = c.figures
  const sev = SEVERITIES.slice().reverse().map((s) => `${SEVERITY_LABELS[s]} ${fig.bySeverity[s]}`).join(' · ')
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text(`Total incidents: ${fig.total} (Static ${fig.bySide.STATIC} · Mobile ${fig.bySide.MOBILE})`)
    .text(`By severity: ${sev}`)
    .text(`Open at shift end: ${fig.openAtEnd} · Average time to resolve: ${fig.avgMinutesToResolve === null ? '—' : `${fig.avgMinutesToResolve} min`}`)
    .text(`Escalation: on time ${fig.escalation.ON_TIME} · late ${fig.escalation.LATE} · not escalated ${fig.escalation.NOT_ESCALATED} · escalated ${fig.escalation.ESCALATED}`)
    .text(`By category: ${fig.byCategory.map((x) => `${x.label} ${x.count}`).join(' · ') || '—'}`)

  const cols = incidentCols(tz)
  heading(doc, 'Critical and high incidents')
  table(doc, cols, c.criticalHigh, 'None.')
  heading(doc, 'Incidents still open')
  table(doc, cols, c.open, 'None.')
  heading(doc, 'All incidents')
  table(doc, cols, c.incidents, 'No incidents were logged on this shift.')

  heading(doc, "Supervisor's report")
  for (const k of REPORT_TEXT_FIELDS) {
    ensureSpace(doc, 30)
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(REPORT_TEXT_LABELS[k], M, doc.y)
    doc.font('Helvetica').fontSize(9.5).fillColor(f[k] ? INK : MUTED).text(f[k] ?? '—', { width })
    doc.moveDown(0.4)
  }
  heading(doc, 'Accountability')
  for (const conf of REPORT_CONFIRMATIONS) doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(`${f[conf.key] ? 'Yes' : 'No'} — ${conf.label}`, M, doc.y, { width })
  if (c.checks.length > 0) {
    heading(doc, 'Data checks')
    for (const chk of c.checks) doc.font('Helvetica').fontSize(9.5).fillColor('#92400e').text(`• ${chk.message}`, M, doc.y, { width })
  }

  // Footer, page numbers and draft watermark on every page
  const range = doc.bufferedPageRange()
  const footer = (i: number) => `Generated ${fmtDateTime(opts.generatedAt.toISOString(), tz)} · Report ${report.id} · Page ${i + 1} of ${range.count}`
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    if (opts.draft) {
      doc.save().fillOpacity(0.08).fillColor(INK).font('Helvetica-Bold').fontSize(96)
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
      doc.text('DRAFT', 0, doc.page.height / 2 - 48, { width: doc.page.width, align: 'center', lineBreak: false })
      doc.restore()
    }
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(footer(i), M, doc.page.height - 28, { width, align: 'center', lineBreak: false })
    doc.page.margins.bottom = bottom
  }
  doc.end()
  return done
}
