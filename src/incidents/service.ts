import { fromDateString, localDateString, SEVERITY_RANK, toDateString, type IncidentDto, type IncidentInputParsed, type LookupType, type PreviousShiftDto } from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { publish } from '../events/bus'
import { env } from '../lib/env'
import { AppError } from '../lib/errors'
import { prisma, type Db } from '../lib/prisma'
import { findShiftAt, type ShiftWithPeople } from '../roster/service'
import type { SessionUser } from '../types'
import { detailInclude, toIncidentDto, type IncidentDetailRow } from './mappers'
import { buildUpdateEvents, canEditIncident, computeIncidentFields, escalationSummary, isResolvedStatus, type IncidentSnapshot } from './rules'
import { nextIncidentRef } from './sequence'

export const NO_ROSTER_MESSAGE = 'No roster for the shift at that time — ask the Deputy Director or an administrator to add it'
const CLOCK_TOLERANCE_MS = 5 * 60_000
const MAX_INT = 2147483647

/** Roles that can never edit incidents are rejected before any validation so they learn nothing about roster coverage. */
function assertEditorRole(actor: SessionUser) {
  if (actor.role !== 'OFFICER' && actor.role !== 'ADMIN') throw new AppError('FORBIDDEN', 'You do not have permission to log or edit incidents')
}

const timeFmt = () => new Intl.DateTimeFormat('en-GB', { timeZone: env.SR_APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })
const fmtTime = (isoValue: string) => timeFmt().format(new Date(isoValue))

/** The current shift and the one immediately before it. */
async function editableWindow(now: Date) {
  const current = await findShiftAt(now)
  const anchor = current?.startsAt ?? now
  const previous = await prisma.shift.findFirst({ where: { endsAt: { lte: anchor } }, orderBy: { endsAt: 'desc' }, include: { definition: true } })
  const ids = [current?.id, previous?.id].filter((id): id is number => id !== undefined)
  return { previous, ids }
}

export async function editableShiftIds(now = new Date()): Promise<number[]> {
  return (await editableWindow(now)).ids
}

/** The previous shift when the user is rostered on it and the late-entry rules still let them log incidents there. */
export async function getPreviousEditableShift(actor: SessionUser, now = new Date()): Promise<PreviousShiftDto | null> {
  const { previous, ids } = await editableWindow(now)
  if (!previous) return null
  const myRole = previous.supervisorId === actor.id ? 'SUPERVISOR' : previous.officerId === actor.id ? 'OFFICER' : null
  if (!myRole || !canEditIncident(actor, previous, ids)) return null
  return {
    id: previous.id,
    shiftDate: toDateString(previous.shiftDate),
    shiftCode: previous.definition.code,
    shiftName: previous.definition.name,
    startsAt: previous.startsAt.toISOString(),
    endsAt: previous.endsAt.toISOString(),
    myRole,
  }
}

function assertNotFuture(occurredAt: Date, now: Date) {
  if (occurredAt.getTime() > now.getTime() + CLOCK_TOLERANCE_MS) {
    throw new AppError('VALIDATION_ERROR', 'The incident time cannot be in the future', { occurredAt: 'The incident time cannot be in the future' })
  }
}

async function assertLookup(db: Db, id: number, listType: LookupType, field: string, label: string, keepId?: number | null) {
  const item = await db.lookupItem.findUnique({ where: { id } })
  const ok = !!item && item.listType === listType && (item.isActive || id === keepId)
  if (!ok) throw new AppError('VALIDATION_ERROR', `Choose a valid ${label}`, { [field]: `Choose a valid ${label}` })
}

async function assertVehicle(id: number, keepId?: number | null) {
  const v = await prisma.vehicle.findUnique({ where: { id } })
  if (!v || !(v.isActive || id === keepId)) {
    throw new AppError('VALIDATION_ERROR', 'Choose a valid vehicle / unit', { vehicleId: 'Choose a valid vehicle / unit' })
  }
}

/** Every referenced list item must exist in the right list and be active, unless it is the value already stored. */
async function assertReferences(input: IncidentInputParsed, existing?: { locationId: number | null; categoryId: number; vehicleId: number | null; platformId: number | null }) {
  if (input.locationId) await assertLookup(prisma, input.locationId, 'LOCATION', 'locationId', 'location', existing?.locationId)
  await assertLookup(prisma, input.categoryId, 'CATEGORY', 'categoryId', 'category', existing?.categoryId)
  if (input.side === 'MOBILE') {
    await assertLookup(prisma, input.platformId, 'PLATFORM', 'platformId', 'platform', existing?.platformId)
    await assertVehicle(input.vehicleId, existing?.vehicleId)
  }
}

async function resolveShiftFor(occurredAt: Date): Promise<ShiftWithPeople> {
  const shift = await findShiftAt(occurredAt)
  if (!shift) throw new AppError('NO_ROSTER', NO_ROSTER_MESSAGE, { occurredAt: NO_ROSTER_MESSAGE })
  return shift
}

async function buildData(input: IncidentInputParsed, shift: ShiftWithPeople, occurredAt: Date) {
  const rule = await prisma.escalationRule.findUnique({ where: { severity: input.severity } })
  const escalatedAt = input.escalatedAt ? new Date(input.escalatedAt) : null
  const resolvedAt = isResolvedStatus(input.status) && input.resolvedAt ? new Date(input.resolvedAt) : null
  const computed = computeIncidentFields({ occurredAt, escalatedTo: input.escalatedTo, escalatedAt, resolvedAt }, rule)
  const sideFields = input.side === 'STATIC'
    ? {
        side: 'STATIC', locationId: input.locationId, locationDetail: input.locationDetail, locationText: null,
        vehicleId: null, vehicleStatus: null, gpsStatus: null, dashcamStatus: null, platformId: null, remarks: null,
      }
    : {
        side: 'MOBILE', locationId: input.locationId, locationDetail: null, locationText: input.locationText,
        vehicleId: input.vehicleId, vehicleStatus: input.vehicleStatus, gpsStatus: input.gpsStatus, dashcamStatus: input.dashcamStatus,
        platformId: input.platformId, remarks: input.remarks,
      }
  return {
    shiftId: shift.id,
    shiftCode: shift.definition.code,
    occurredAt,
    occurredLocalDate: fromDateString(localDateString(occurredAt, env.SR_APP_TIMEZONE)),
    ...sideFields,
    categoryId: input.categoryId,
    severity: input.severity,
    severityRank: SEVERITY_RANK[input.severity],
    description: input.description,
    immediateAction: input.immediateAction,
    escalatedTo: input.escalatedTo,
    escalatedAt,
    assignedTo: input.assignedTo,
    status: input.status,
    resolvedAt,
    resolution: input.resolution,
    ...computed,
  }
}

interface SnapshotSource {
  occurredAt: Date
  locationId: number | null
  locationDetail: string | null
  categoryId: number
  severity: string
  description: string
  immediateAction: string | null
  escalatedTo: string | null
  escalatedAt: Date | null
  assignedTo: string | null
  status: string
  resolvedAt: Date | null
  resolution: string | null
  locationText: string | null
  vehicleId: number | null
  vehicleStatus: string | null
  gpsStatus: string | null
  dashcamStatus: string | null
  platformId: number | null
  remarks: string | null
}

function snapshotOf(d: SnapshotSource): IncidentSnapshot {
  return {
    occurredAt: d.occurredAt.toISOString(),
    locationId: d.locationId,
    locationDetail: d.locationDetail,
    categoryId: d.categoryId,
    severity: d.severity,
    description: d.description,
    immediateAction: d.immediateAction,
    escalatedTo: d.escalatedTo,
    escalatedAt: d.escalatedAt?.toISOString() ?? null,
    assignedTo: d.assignedTo,
    status: d.status as IncidentSnapshot['status'],
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
    resolution: d.resolution,
    locationText: d.locationText,
    vehicleId: d.vehicleId,
    vehicleStatus: d.vehicleStatus,
    gpsStatus: d.gpsStatus,
    dashcamStatus: d.dashcamStatus,
    platformId: d.platformId,
    remarks: d.remarks,
  }
}

async function loadDetail(where: { id: number } | { ref: string }): Promise<IncidentDetailRow | null> {
  return prisma.incident.findFirst({ where, include: detailInclude })
}

export async function getIncident(idOrRef: string, actor: SessionUser, now = new Date()): Promise<IncidentDto> {
  const numeric = /^\d+$/.test(idOrRef)
  if (numeric && Number(idOrRef) > MAX_INT) throw new AppError('NOT_FOUND', 'Incident not found')
  const row = await loadDetail(numeric ? { id: Number(idOrRef) } : { ref: idOrRef.toUpperCase() })
  if (!row) throw new AppError('NOT_FOUND', 'Incident not found')
  const canEdit = canEditIncident(actor, row.shift, await editableShiftIds(now))
  return toIncidentDto(row, { canEdit, actor, timeZone: env.SR_APP_TIMEZONE })
}

export async function createIncident(actor: SessionUser, input: IncidentInputParsed, ip: string | null, now = new Date()): Promise<IncidentDto> {
  assertEditorRole(actor)
  const occurredAt = new Date(input.occurredAt)
  assertNotFuture(occurredAt, now)
  const shift = await resolveShiftFor(occurredAt)
  if (!canEditIncident(actor, shift, await editableShiftIds(now))) {
    throw new AppError('FORBIDDEN', 'You can only log incidents for your current or previous shift')
  }
  await assertReferences(input)
  const data = await buildData(input, shift, occurredAt)

  const id = await prisma.$transaction(async (tx) => {
    const ref = await nextIncidentRef(tx, occurredAt, input.side)
    const row = await tx.incident.create({ data: { ...data, ref, reportedById: actor.id, createdById: actor.id, updatedById: actor.id } })
    const events = [{ kind: 'CREATED', summary: `Logged by ${actor.fullName}` }]
    if (row.escalatedTo) events.push({ kind: 'ESCALATED', summary: escalationSummary(row.escalatedTo, row.escalatedAt?.toISOString() ?? null, fmtTime) })
    if (isResolvedStatus(input.status)) events.push({ kind: 'RESOLVED', summary: input.resolution ? `Resolved: ${input.resolution}`.slice(0, 300) : 'Resolved' })
    await tx.incidentEvent.createMany({ data: events.map((e) => ({ ...e, incidentId: row.id, userId: actor.id })) })
    await writeAudit(tx, { userId: actor.id, entity: 'Incident', entityId: row.id, action: 'CREATE', after: { ref, side: data.side, ...snapshotOf(data) }, ip })
    return row.id
  })
  publish('incidents', 'audit')
  return getIncident(String(id), actor, now)
}

export async function updateIncident(actor: SessionUser, id: number, input: IncidentInputParsed, ip: string | null, now = new Date()): Promise<IncidentDto> {
  assertEditorRole(actor)
  const existing = await loadDetail({ id })
  if (!existing) throw new AppError('NOT_FOUND', 'Incident not found')
  const editable = await editableShiftIds(now)
  if (!canEditIncident(actor, existing.shift, editable)) throw new AppError('FORBIDDEN', 'You can no longer edit this incident')
  if (input.side !== existing.side) {
    throw new AppError('VALIDATION_ERROR', 'The side cannot be changed', { side: 'The side cannot be changed' })
  }

  const occurredAt = new Date(input.occurredAt)
  assertNotFuture(occurredAt, now)
  let shift: ShiftWithPeople = existing.shift
  if (occurredAt.getTime() !== existing.occurredAt.getTime()) {
    shift = await resolveShiftFor(occurredAt)
    if (!canEditIncident(actor, shift, editable)) throw new AppError('FORBIDDEN', 'You can only move an incident to your current or previous shift')
  }
  await assertReferences(input, existing)
  const data = await buildData(input, shift, occurredAt)
  const before = snapshotOf(existing)
  const after = snapshotOf(data)
  const events = buildUpdateEvents(before, after, fmtTime)

  await prisma.$transaction(async (tx) => {
    await tx.incident.update({ where: { id }, data: { ...data, updatedById: actor.id } })
    if (events.length > 0) await tx.incidentEvent.createMany({ data: events.map((e) => ({ ...e, incidentId: id, userId: actor.id })) })
    await writeAudit(tx, { userId: actor.id, entity: 'Incident', entityId: id, action: 'UPDATE', before: { ref: existing.ref, ...before }, after: { ref: existing.ref, ...after }, ip })
  })
  publish('incidents', 'audit')
  return getIncident(String(id), actor, now)
}
