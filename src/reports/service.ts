import {
  incidentPlace, reportSubmitProblems, toDateString,
  type EscalationResult, type IncidentSide, type IncidentStatus, type OverallStatus, type Paged, type ReportContentDto, type ReportFieldsDto,
  type ReportListItemDto, type ReportQuery, type ReportStatus, type ReportTimeliness, type ReportUpdateParsed, type Severity, type ShiftReportDto,
} from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { getSettings } from '../config/settings'
import { queueEmail } from '../email/queue'
import { publish } from '../events/bus'
import type { Prisma } from '../generated/prisma/client'
import { listInclude, type IncidentListRow } from '../incidents/mappers'
import { AppError } from '../lib/errors'
import { prisma, type Db } from '../lib/prisma'
import type { SessionUser } from '../types'
import { buildReportContent, computeTimeliness, reportDeadline, type ReportIncidentInput } from './build'

const shiftInclude = { definition: true, supervisor: true, officer: true } as const
type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>
const reportInclude = { shift: { include: shiftInclude }, submittedBy: true } as const
type ReportRow = Prisma.ShiftReportGetPayload<{ include: typeof reportInclude }>
interface Snapshot { content: ReportContentDto; fields: ReportFieldsDto }

let afterSubmit: (reportId: number) => Promise<void> = async () => {}
/** Task 4 plugs PDF storage in here; failures are logged and never undo a submit. */
export function setAfterSubmit(fn: (reportId: number) => Promise<void>) { afterSubmit = fn }

const person = (u: { id: number; fullName: string }) => ({ id: u.id, fullName: u.fullName })

function fieldsOf(r: ReportRow): ReportFieldsDto {
  return {
    overallStatus: r.overallStatus as OverallStatus | null,
    overview: r.overview, keyEvents: r.keyEvents, pendingActions: r.pendingActions,
    operationalConcerns: r.operationalConcerns, recommendations: r.recommendations,
    confirmReviewed: r.confirmReviewed, confirmEscalated: r.confirmEscalated, confirmHandedOver: r.confirmHandedOver, confirmSubmitted: r.confirmSubmitted,
  }
}

function incidentInput(r: IncidentListRow): ReportIncidentInput {
  const where = incidentPlace({ location: r.location ? { id: r.location.id, value: r.location.value } : null, locationText: r.locationText })
  const place = r.side === 'MOBILE' ? `${r.vehicle?.unitId ?? '—'} · ${where}` : r.locationDetail ? `${where} · ${r.locationDetail}` : where
  return {
    id: r.id, ref: r.ref, side: r.side as IncidentSide, occurredAt: r.occurredAt.toISOString(), place,
    category: r.category.value, severity: r.severity as Severity, status: r.status as IncidentStatus,
    escalationResult: r.escalationResult as EscalationResult, minutesToResolve: r.minutesToResolve, description: r.description,
  }
}

async function liveContent(shift: ShiftRow, fields: ReportFieldsDto, deadlineMinutes: number, db: Db = prisma): Promise<ReportContentDto> {
  const rows = await db.incident.findMany({ where: { shiftId: shift.id }, include: listInclude, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
  return buildReportContent({
    id: shift.id, shiftDate: toDateString(shift.shiftDate), shiftCode: shift.definition.code, shiftName: shift.definition.name,
    startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString(),
    supervisor: person(shift.supervisor), officer: person(shift.officer),
  }, rows.map(incidentInput), deadlineMinutes, fields)
}

type Access = 'supervisor' | 'read'
function accessFor(actor: SessionUser, shift: { supervisorId: number; officerId: number }): Access | null {
  if (actor.id === shift.supervisorId) return 'supervisor'
  if (actor.id === shift.officerId || actor.role === 'DEPUTY_DIRECTOR' || actor.role === 'ADMIN') return 'read'
  return null
}

export function assertCanReadShiftReport(actor: SessionUser, shift: { supervisorId: number; officerId: number }) {
  if (!accessFor(actor, shift)) throw new AppError('FORBIDDEN', 'You do not have access to this report')
}

async function toDto(r: ReportRow, actor: SessionUser | null, now: Date): Promise<ShiftReportDto> {
  const { reportDeadlineMinutes } = await getSettings()
  const submitted = r.status === 'SUBMITTED'
  const snap = submitted && r.snapshotJson ? (JSON.parse(r.snapshotJson) as Snapshot) : null
  const fields = snap?.fields ?? fieldsOf(r)
  const content = snap?.content ?? (await liveContent(r.shift, fields, reportDeadlineMinutes))
  const isSupervisor = !!actor && actor.id === r.shift.supervisorId
  return {
    id: r.id, shiftId: r.shiftId, status: r.status as ReportStatus, fields, content,
    submittedBy: r.submittedBy ? person(r.submittedBy) : null,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    timeliness: r.timeliness as ReportTimeliness | null,
    lateMinutes: r.lateMinutes,
    overdue: !submitted && now > reportDeadline(r.shift.endsAt, reportDeadlineMinutes),
    updatedAt: r.updatedAt.toISOString(),
    canEdit: isSupervisor && !submitted,
    canSubmit: isSupervisor && !submitted,
  }
}

/** Creates the draft row for a rostered shift if it does not exist yet. */
export async function ensureDraft(db: Db, shiftId: number): Promise<{ id: number }> {
  const existing = await db.shiftReport.findUnique({ where: { shiftId }, select: { id: true } })
  if (existing) return existing
  try {
    return await db.shiftReport.create({ data: { shiftId }, select: { id: true } })
  } catch {
    return db.shiftReport.findUniqueOrThrow({ where: { shiftId }, select: { id: true } }) // created concurrently
  }
}

async function loadShift(shiftId: number): Promise<ShiftRow> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: shiftInclude })
  if (!shift) throw new AppError('NOT_FOUND', 'No one is rostered for this shift')
  return shift
}

const loadRow = (id: number) => prisma.shiftReport.findUniqueOrThrow({ where: { id }, include: reportInclude })

/** For the email worker and PDF: no access check. */
export async function loadReportDto(reportId: number, now = new Date(), actor: SessionUser | null = null): Promise<ShiftReportDto> {
  return toDto(await loadRow(reportId), actor, now)
}

export async function getShiftReport(actor: SessionUser, shiftId: number, now = new Date()): Promise<ShiftReportDto> {
  const shift = await loadShift(shiftId)
  assertCanReadShiftReport(actor, shift)
  const { id } = await ensureDraft(prisma, shiftId)
  return toDto(await loadRow(id), actor, now)
}

export async function getReportById(actor: SessionUser, id: number, now = new Date()): Promise<ShiftReportDto> {
  const row = await prisma.shiftReport.findUnique({ where: { id }, include: reportInclude })
  if (!row) throw new AppError('NOT_FOUND', 'Report not found')
  assertCanReadShiftReport(actor, row.shift)
  return toDto(row, actor, now)
}

async function editableRow(actor: SessionUser, shiftId: number) {
  const shift = await loadShift(shiftId)
  if (accessFor(actor, shift) !== 'supervisor') throw new AppError('FORBIDDEN', 'Only the Shift Supervisor can edit and submit this report')
  const { id } = await ensureDraft(prisma, shiftId)
  const row = await loadRow(id)
  if (row.status === 'SUBMITTED') throw new AppError('CONFLICT', 'This report has been submitted and can no longer be changed')
  return row
}

export async function updateShiftReport(actor: SessionUser, shiftId: number, input: ReportUpdateParsed, _ip: string | null): Promise<ShiftReportDto> {
  const row = await editableRow(actor, shiftId)
  if (row.updatedAt.getTime() !== new Date(input.updatedAt).getTime()) {
    throw new AppError('CONFLICT', 'This report was updated elsewhere. Reload the draft.')
  }
  const { updatedAt: _u, ...fields } = input
  const res = await prisma.shiftReport.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, status: 'DRAFT' }, data: fields })
  if (res.count === 0) throw new AppError('CONFLICT', 'This report was updated elsewhere. Reload the draft.')
  return toDto(await loadRow(row.id), actor, new Date())
}

export async function submitShiftReport(actor: SessionUser, shiftId: number, ip: string | null, now = new Date()): Promise<ShiftReportDto> {
  const row = await editableRow(actor, shiftId)
  const fields = fieldsOf(row)
  const problems = reportSubmitProblems(fields)
  if (Object.keys(problems).length > 0) throw new AppError('VALIDATION_ERROR', 'Complete the report before submitting', problems)
  const settings = await getSettings()
  const { timeliness, lateMinutes } = computeTimeliness(now, row.shift.endsAt, settings.reportDeadlineMinutes)
  await prisma.$transaction(async (tx) => {
    const content = await liveContent(row.shift, fields, settings.reportDeadlineMinutes, tx)
    const snapshot: Snapshot = { content, fields }
    const res = await tx.shiftReport.updateMany({
      where: { id: row.id, status: 'DRAFT' },
      data: { status: 'SUBMITTED', submittedAt: now, submittedById: actor.id, timeliness, lateMinutes, snapshotJson: JSON.stringify(snapshot) },
    })
    if (res.count === 0) throw new AppError('CONFLICT', 'This report has already been submitted')
    await writeAudit(tx, { userId: actor.id, entity: 'ShiftReport', entityId: row.id, action: 'SUBMIT', after: { shiftId, timeliness, lateMinutes }, ip })
    const recipients = settings.ddEmails.length > 0 ? settings.ddEmails : ['']
    for (const to of recipients) await queueEmail(tx, { type: 'REPORT_SUBMITTED', to, reportId: row.id, shiftId, createdById: actor.id })
  })
  publish('reports', 'incidents', 'audit')
  afterSubmit(row.id).catch((err) => console.error('[report pdf]', err))
  return toDto(await loadRow(row.id), actor, now)
}

export async function listReports(q: ReportQuery, now = new Date()): Promise<Paged<ReportListItemDto>> {
  const { reportDeadlineMinutes } = await getSettings()
  const pageSize = 25
  const overdueBefore = new Date(now.getTime() - reportDeadlineMinutes * 60_000)
  const shiftWhere: Prisma.ShiftWhereInput = {
    ...(q.from || q.to ? { shiftDate: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) } } : {}),
    ...(q.shiftCode ? { definition: { code: q.shiftCode } } : {}),
    ...(q.status === 'OVERDUE' ? { endsAt: { lt: overdueBefore } } : {}),
  }
  const where: Prisma.ShiftReportWhereInput = {
    shift: shiftWhere,
    ...(q.status === 'OVERDUE' ? { status: 'DRAFT' } : q.status ? { status: q.status } : {}),
    ...(q.timeliness ? { timeliness: q.timeliness } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.shiftReport.count({ where }),
    prisma.shiftReport.findMany({ where, include: reportInclude, orderBy: [{ shift: { startsAt: 'desc' } }, { id: 'desc' }], skip: (q.page - 1) * pageSize, take: pageSize }),
  ])
  return {
    total, page: q.page, pageSize,
    items: rows.map((r) => {
      const deadline = reportDeadline(r.shift.endsAt, reportDeadlineMinutes)
      return {
        id: r.id, shiftId: r.shiftId, shiftDate: toDateString(r.shift.shiftDate), shiftCode: r.shift.definition.code, shiftName: r.shift.definition.name,
        supervisor: person(r.shift.supervisor), status: r.status as ReportStatus, overallStatus: r.overallStatus as OverallStatus | null,
        submittedAt: r.submittedAt?.toISOString() ?? null, timeliness: r.timeliness as ReportTimeliness | null, lateMinutes: r.lateMinutes,
        overdue: r.status === 'DRAFT' && now > deadline, deadline: deadline.toISOString(),
      }
    }),
  }
}
