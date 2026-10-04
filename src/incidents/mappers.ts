import {
  localDateString, toDateString,
  type EscalationResult, type IncidentDto, type IncidentEventKind, type IncidentListItemDto, type IncidentSide, type IncidentStatus, type LinkStatus, type Severity, type VehicleStatus,
} from '@sr/shared'
import type { Prisma } from '../generated/prisma/client'

export const listInclude = {
  location: true,
  vehicle: true,
  platform: true,
  category: true,
  reportedBy: true,
  shift: { include: { definition: true, supervisor: true, officer: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.IncidentInclude

export const detailInclude = {
  ...listInclude,
  attachments: { include: { uploadedBy: true }, orderBy: { createdAt: 'asc' } },
  events: { include: { user: true }, orderBy: [{ at: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.IncidentInclude

export type IncidentListRow = Prisma.IncidentGetPayload<{ include: typeof listInclude }>
export type IncidentDetailRow = Prisma.IncidentGetPayload<{ include: typeof detailInclude }>

const person = (u: { id: number; fullName: string }) => ({ id: u.id, fullName: u.fullName })
const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function toIncidentListItem(r: IncidentListRow): IncidentListItemDto {
  return {
    id: r.id,
    ref: r.ref,
    side: r.side as IncidentSide,
    occurredAt: r.occurredAt.toISOString(),
    shiftId: r.shiftId,
    shiftDate: toDateString(r.shift.shiftDate),
    shiftCode: r.shift.definition.code,
    shiftName: r.shift.definition.name,
    supervisorName: r.shift.supervisor.fullName,
    location: r.location ? { id: r.location.id, value: r.location.value } : null,
    locationDetail: r.locationDetail,
    locationText: r.locationText,
    vehicle: r.vehicle ? { id: r.vehicle.id, unitId: r.vehicle.unitId } : null,
    vehicleStatus: r.vehicleStatus as VehicleStatus | null,
    gpsStatus: r.gpsStatus as LinkStatus | null,
    dashcamStatus: r.dashcamStatus as LinkStatus | null,
    platform: r.platform ? { id: r.platform.id, value: r.platform.value } : null,
    category: { id: r.category.id, value: r.category.value },
    severity: r.severity as Severity,
    status: r.status as IncidentStatus,
    escalationResult: r.escalationResult as EscalationResult,
    reportedBy: person(r.reportedBy),
    attachmentCount: r._count.attachments,
  }
}

export function toIncidentDto(r: IncidentDetailRow, ctx: { canEdit: boolean; actor: { id: number; role: string }; timeZone: string }): IncidentDto {
  return {
    ...toIncidentListItem(r),
    description: r.description,
    immediateAction: r.immediateAction,
    escalatedTo: r.escalatedTo,
    escalatedAt: iso(r.escalatedAt),
    escalationMinutes: r.escalationMinutes,
    assignedTo: r.assignedTo,
    resolvedAt: iso(r.resolvedAt),
    resolution: r.resolution,
    remarks: r.remarks,
    minutesToResolve: r.minutesToResolve,
    officerName: r.shift.officer.fullName,
    afterMidnight: localDateString(r.occurredAt, ctx.timeZone) !== toDateString(r.shift.shiftDate),
    canEdit: ctx.canEdit,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    attachments: r.attachments.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedBy: person(a.uploadedBy),
      createdAt: a.createdAt.toISOString(),
      url: `/api/attachments/${a.id}`,
      canDelete: ctx.actor.role === 'ADMIN' || (a.uploadedById === ctx.actor.id && ctx.canEdit),
    })),
    events: r.events.map((e) => ({ id: e.id, kind: e.kind as IncidentEventKind, summary: e.summary, at: e.at.toISOString(), user: e.user ? person(e.user) : null })),
  }
}
