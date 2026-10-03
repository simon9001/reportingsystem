import { ESCALATION_RESULT_LABELS, INCIDENT_STATUS_LABELS, SEVERITY_LABELS, type EscalationResult, type IncidentQuery, type IncidentStatus, type Severity } from '@sr/shared'
import ExcelJS from 'exceljs'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { listInclude } from './mappers'
import { buildIncidentWhere, incidentOrderBy } from './query'

export const EXPORT_LIMIT = 10_000
const SEVERITY_FILL: Record<Severity, string> = { CRITICAL: 'FFFEE2E2', HIGH: 'FFFFEDD5', MEDIUM: 'FFFEF3C7', LOW: 'FFDCFCE7' }

/** Excel shows the stored instant as-is, so convert UTC to the business wall-clock time. */
function wallClock(d: Date | null, tz = env.SR_APP_TIMEZONE): Date | null {
  if (!d) return null
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  )
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)))
}

export async function buildIncidentWorkbook(q: IncidentQuery, limit = EXPORT_LIMIT): Promise<{ buffer: Buffer; truncated: boolean }> {
  const found = await prisma.incident.findMany({
    where: buildIncidentWhere(q),
    include: { ...listInclude, shift: { include: { definition: true, supervisor: true, officer: true } } },
    orderBy: incidentOrderBy(q.sort),
    take: limit + 1,
  })
  const truncated = found.length > limit
  const rows = truncated ? found.slice(0, limit) : found
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Control Room Reporting'
  const ws = wb.addWorksheet('Incidents', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [
    { header: 'Incident', key: 'ref', width: 15 },
    { header: 'Occurred', key: 'occurredAt', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Shift', key: 'shift', width: 18 },
    { header: 'Supervisor', key: 'supervisor', width: 20 },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Location detail', key: 'locationDetail', width: 20 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Reported by', key: 'reportedBy', width: 20 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Immediate action', key: 'immediateAction', width: 30 },
    { header: 'Escalated to', key: 'escalatedTo', width: 18 },
    { header: 'Escalated at', key: 'escalatedAt', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Escalation', key: 'escalation', width: 14 },
    { header: 'Resolved at', key: 'resolvedAt', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'Minutes to resolve', key: 'minutesToResolve', width: 10 },
    { header: 'Resolution', key: 'resolution', width: 30 },
    { header: 'Snapshots', key: 'snapshots', width: 10 },
  ]
  for (const r of rows) {
    const row = ws.addRow({
      ref: r.ref,
      occurredAt: wallClock(r.occurredAt),
      shift: `${r.shift.definition.name} ${r.shift.shiftDate.toISOString().slice(0, 10)}`,
      supervisor: safeText(r.shift.supervisor.fullName),
      location: safeText(r.location.value),
      locationDetail: safeText(r.locationDetail),
      category: safeText(r.category.value),
      severity: SEVERITY_LABELS[r.severity as Severity],
      status: INCIDENT_STATUS_LABELS[r.status as IncidentStatus],
      reportedBy: safeText(r.reportedBy.fullName),
      description: safeText(r.description),
      immediateAction: safeText(r.immediateAction),
      escalatedTo: safeText(r.escalatedTo),
      escalatedAt: wallClock(r.escalatedAt),
      escalation: ESCALATION_RESULT_LABELS[r.escalationResult as EscalationResult],
      resolvedAt: wallClock(r.resolvedAt),
      minutesToResolve: r.minutesToResolve,
      resolution: safeText(r.resolution),
      snapshots: r._count.attachments,
    })
    row.getCell('severity').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILL[r.severity as Severity] } }
  }
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } }
  addAbout(wb, q, rows.length, truncated, limit)
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), truncated }
}

/** Neutralises spreadsheet formulas: text starting with = + - @ tab or CR is prefixed with a quote. */
export function safeText(v: string | null): string | null {
  return v !== null && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

function addAbout(wb: ExcelJS.Workbook, q: IncidentQuery, count: number, truncated: boolean, limit: number) {
  const ws = wb.addWorksheet('About')
  ws.getColumn(1).width = 110
  const generated = new Intl.DateTimeFormat('en-GB', { timeZone: env.SR_APP_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const filters = [
    q.from && `from ${q.from}`,
    q.to && `to ${q.to}`,
    q.severity && `severity ${q.severity.join(', ')}`,
    q.status && `status ${q.status.join(', ')}`,
    q.categoryId && `category ids ${q.categoryId.join(', ')}`,
    q.locationId && `location ids ${q.locationId.join(', ')}`,
    q.shiftCode && `shift ${q.shiftCode}`,
    q.shiftId && `shift id ${q.shiftId}`,
    q.q?.trim() && `search "${q.q.trim()}"`,
  ].filter(Boolean)
  ws.addRow([`Generated: ${generated} (${env.SR_APP_TIMEZONE})`])
  ws.addRow([`Filters: ${filters.length ? filters.join('; ') : 'none'}`])
  ws.addRow([`Rows: ${count}`])
  if (truncated) ws.addRow([`Only the first ${limit.toLocaleString('en-US')} matching incidents are included. Narrow the filters to export the rest.`])
}
