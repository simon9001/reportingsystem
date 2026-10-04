import {
  ESCALATION_RESULT_LABELS, INCIDENT_STATUS_LABELS, LINK_STATUS_LABELS, SEVERITY_LABELS, VEHICLE_STATUS_LABELS,
  type EscalationResult, type IncidentQuery, type IncidentStatus, type LinkStatus, type Severity, type VehicleStatus,
} from '@sr/shared'
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

type ExportRow = Awaited<ReturnType<typeof loadRows>>[number]
interface Column { header: string; width: number; numFmt?: string; value: (r: ExportRow) => ExcelJS.CellValue }

const DATE = 'dd/mm/yyyy'
const TIME = 'hh:mm'
const DATETIME = 'dd/mm/yyyy hh:mm'
const place = (r: ExportRow) => r.location?.value ?? r.locationText ?? ''

const head: Column[] = [
  { header: 'Incident ID', width: 15, value: (r) => r.ref },
  { header: 'Date', width: 12, numFmt: DATE, value: (r) => wallClock(r.occurredAt) },
  { header: 'Time', width: 8, numFmt: TIME, value: (r) => wallClock(r.occurredAt) },
  { header: 'Shift', width: 10, value: (r) => safeText(r.shift.definition.name) },
  { header: 'Shift Date', width: 12, numFmt: DATE, value: (r) => r.shift.shiftDate },
]
const tracking = (resolutionHeader: string): Column[] => [
  { header: 'Notified / Escalated To', width: 20, value: (r) => safeText(r.escalatedTo) },
  { header: 'Escalated At', width: 17, numFmt: DATETIME, value: (r) => wallClock(r.escalatedAt) },
  { header: 'Assigned To', width: 18, value: (r) => safeText(r.assignedTo) },
  { header: 'Status', width: 12, value: (r) => INCIDENT_STATUS_LABELS[r.status as IncidentStatus] },
  { header: 'Resolved At', width: 17, numFmt: DATETIME, value: (r) => wallClock(r.resolvedAt) },
  { header: resolutionHeader, width: 30, value: (r) => safeText(r.resolution) },
  { header: 'Evidence', width: 9, value: (r) => r._count.attachments },
  { header: 'Time to Resolve (min)', width: 10, value: (r) => r.minutesToResolve },
  { header: 'Escalation Check', width: 14, value: (r) => ESCALATION_RESULT_LABELS[r.escalationResult as EscalationResult] },
]
const severity: Column = { header: 'Severity', width: 10, value: (r) => SEVERITY_LABELS[r.severity as Severity] }
const category: Column = { header: 'Category', width: 16, value: (r) => safeText(r.category.value) }

/** Incident Register sheet order. */
const STATIC_COLUMNS: Column[] = [
  ...head,
  { header: 'Location', width: 20, value: (r) => safeText(r.locationDetail ? `${place(r)} · ${r.locationDetail}` : place(r)) },
  category,
  severity,
  { header: 'Reported By', width: 20, value: (r) => safeText(r.reportedBy.fullName) },
  { header: 'Description', width: 40, value: (r) => safeText(r.description) },
  { header: 'Immediate Action', width: 30, value: (r) => safeText(r.immediateAction) },
  ...tracking('Resolution / Handover'),
]

/** Mobile Weighbridge sheet order, then the tracking columns. */
const MOBILE_COLUMNS: Column[] = [
  ...head,
  { header: 'Vehicle / Unit ID', width: 14, value: (r) => safeText(r.vehicle?.unitId ?? '') },
  { header: 'Location', width: 18, value: (r) => safeText(place(r)) },
  { header: 'Vehicle Status', width: 12, value: (r) => (r.vehicleStatus ? VEHICLE_STATUS_LABELS[r.vehicleStatus as VehicleStatus] : null) },
  { header: 'GPS Status', width: 11, value: (r) => (r.gpsStatus ? LINK_STATUS_LABELS[r.gpsStatus as LinkStatus] : null) },
  { header: 'Dashcam Status', width: 13, value: (r) => (r.dashcamStatus ? LINK_STATUS_LABELS[r.dashcamStatus as LinkStatus] : null) },
  { header: 'Platform', width: 12, value: (r) => safeText(r.platform?.value ?? '') },
  { header: 'Event / Incident', width: 40, value: (r) => safeText(r.description) },
  { header: 'Action Taken', width: 30, value: (r) => safeText(r.immediateAction) },
  { header: 'Remarks', width: 30, value: (r) => safeText(r.remarks) },
  { header: 'Logged By', width: 20, value: (r) => safeText(r.reportedBy.fullName) },
  category,
  severity,
  ...tracking('Resolution'),
]

function loadRows(q: IncidentQuery, limit: number) {
  return prisma.incident.findMany({
    where: buildIncidentWhere(q),
    include: { ...listInclude, shift: { include: { definition: true, supervisor: true, officer: true } } },
    orderBy: incidentOrderBy(q.sort),
    take: limit + 1,
  })
}

function addSheet(wb: ExcelJS.Workbook, name: string, columns: Column[], rows: ExportRow[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width, ...(c.numFmt ? { style: { numFmt: c.numFmt } } : {}) }))
  const severityCol = columns.findIndex((c) => c.header === 'Severity') + 1
  for (const r of rows) {
    const row = ws.addRow(Object.fromEntries(columns.map((c, i) => [`c${i}`, c.value(r)])))
    row.getCell(severityCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILL[r.severity as Severity] } }
  }
  ws.getRow(1).font = { bold: true }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
}

export async function buildIncidentWorkbook(q: IncidentQuery, limit = EXPORT_LIMIT): Promise<{ buffer: Buffer; truncated: boolean }> {
  const found = await loadRows(q, limit)
  const truncated = found.length > limit
  const rows = truncated ? found.slice(0, limit) : found
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Control Room Reporting'
  const staticRows = rows.filter((r) => r.side !== 'MOBILE')
  const mobileRows = rows.filter((r) => r.side === 'MOBILE')
  if (q.side !== 'MOBILE') addSheet(wb, 'Static weighbridges', STATIC_COLUMNS, staticRows)
  if (q.side !== 'STATIC') addSheet(wb, 'Mobile weighbridges', MOBILE_COLUMNS, mobileRows)
  addAbout(wb, q, { total: rows.length, static: staticRows.length, mobile: mobileRows.length }, truncated, limit)
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), truncated }
}

/**
 * Neutralises spreadsheet formulas: text whose first non-blank character is = is prefixed with a quote.
 * Leading -, + and @ are left alone so readings like "-ve" and phone numbers like "+254…" stay as typed.
 */
export function safeText(v: string | null): string | null {
  return v !== null && /^[\s]*=/.test(v) ? `'${v}` : v
}

function addAbout(wb: ExcelJS.Workbook, q: IncidentQuery, counts: { total: number; static: number; mobile: number }, truncated: boolean, limit: number) {
  const ws = wb.addWorksheet('About')
  ws.getColumn(1).width = 110
  const generated = new Intl.DateTimeFormat('en-GB', { timeZone: env.SR_APP_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const filters = [
    q.side && `side ${q.side}`,
    q.from && `from ${q.from}`,
    q.to && `to ${q.to}`,
    q.severity && `severity ${q.severity.join(', ')}`,
    q.status && `status ${q.status.join(', ')}`,
    q.categoryId && `category ids ${q.categoryId.join(', ')}`,
    q.locationId && `location ids ${q.locationId.join(', ')}`,
    q.vehicleId && `vehicle ids ${q.vehicleId.join(', ')}`,
    q.platformId && `platform ids ${q.platformId.join(', ')}`,
    q.vehicleStatus && `vehicle status ${q.vehicleStatus.join(', ')}`,
    q.gpsStatus && `GPS status ${q.gpsStatus.join(', ')}`,
    q.dashcamStatus && `dashcam status ${q.dashcamStatus.join(', ')}`,
    q.shiftCode && `shift ${q.shiftCode}`,
    q.shiftId && `shift id ${q.shiftId}`,
    q.hasAttachments && `has snapshots ${q.hasAttachments}`,
    q.reportedById && `reported by id ${q.reportedById}`,
    q.q?.trim() && `search "${q.q.trim()}"`,
  ].filter(Boolean)
  ws.addRow([`Generated: ${generated} (${env.SR_APP_TIMEZONE})`])
  ws.addRow([`Filters: ${filters.length ? filters.join('; ') : 'none'}`])
  ws.addRow([`Rows: ${counts.total}`])
  if (truncated) ws.addRow([`Only the first ${limit.toLocaleString('en-US')} matching incidents are included. Narrow the filters to export the rest.`])
  ws.addRow([`Static weighbridges: ${counts.static} · Mobile weighbridges: ${counts.mobile}`])
}
