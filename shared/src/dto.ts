import type { AuditAction, EscalationResult, IncidentEventKind, IncidentStatus, LookupType, Role, Severity, ShiftRole } from './constants'

export interface SessionUserDto { id: number; fullName: string; email: string; role: Role; mustChangePassword: boolean }
export interface UserDto extends SessionUserDto { isActive: boolean; lastLoginAt: string | null; createdAt: string }
export interface PersonRef { id: number; fullName: string }
/** A person on a roster shift; `rosterable` is false when they are now inactive or no longer a Control Room Officer. */
export interface RosterPersonRef extends PersonRef { rosterable: boolean }
/** Result of editing a user: `futureShifts` counts upcoming roster shifts that still name them after being deactivated or demoted. */
export type UpdateUserResult = UserDto & { futureShifts: number }

export interface ShiftDto {
  id: number
  shiftDate: string
  shiftCode: string
  shiftName: string
  startsAt: string
  endsAt: string
  supervisor: RosterPersonRef
  officer: RosterPersonRef
}

/** The shift happening now. `shift` is null when nobody has been rostered for it. */
export interface CurrentShiftDto {
  shiftDate: string
  shiftCode: string
  shiftName: string
  startsAt: string
  endsAt: string
  shift: ShiftDto | null
  myRole: ShiftRole | null
}

/** The shift just before the current one, when the user is rostered on it and may still add late entries. */
export interface PreviousShiftDto {
  id: number
  shiftDate: string
  shiftCode: string
  shiftName: string
  startsAt: string
  endsAt: string
  myRole: ShiftRole
}

export interface MeResponse { user: SessionUserDto; currentShift: CurrentShiftDto | null; previousShift: PreviousShiftDto | null }

export interface ShiftDefinitionDto { id: number; code: string; name: string; startTime: string; endTime: string; sortOrder: number; isActive: boolean }
export interface EscalationRuleDto { severity: Severity; isRequired: boolean; notifyWho: string | null; withinMinutes: number | null }
export interface LookupItemDto { id: number; listType: LookupType; value: string; sortOrder: number; isActive: boolean }
export interface VehicleDto { id: number; unitId: string; description: string | null; isActive: boolean }

export interface AuditLogDto {
  id: number
  at: string
  user: PersonRef | null
  entity: string
  entityId: string | null
  action: AuditAction
  before: unknown
  after: unknown
  ip: string | null
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface CopyWeekResult { created: number; skipped: number }
export interface ApiErrorBody { error: { code: string; message: string; fields?: Record<string, string>; requestId?: string } }

export interface LookupRef { id: number; value: string }

export interface IncidentListItemDto {
  id: number
  ref: string
  occurredAt: string
  shiftId: number
  shiftDate: string
  shiftCode: string
  shiftName: string
  supervisorName: string
  location: LookupRef
  locationDetail: string | null
  category: LookupRef
  severity: Severity
  status: IncidentStatus
  escalationResult: EscalationResult
  reportedBy: PersonRef
  attachmentCount: number
}

export interface IncidentAttachmentDto {
  id: number
  originalName: string
  mimeType: string
  sizeBytes: number
  uploadedBy: PersonRef
  createdAt: string
  url: string
  canDelete: boolean
}

export interface IncidentEventDto { id: number; kind: IncidentEventKind; summary: string; at: string; user: PersonRef | null }

export interface IncidentDto extends IncidentListItemDto {
  description: string
  immediateAction: string | null
  escalatedTo: string | null
  escalatedAt: string | null
  escalationMinutes: number | null
  assignedTo: string | null
  resolvedAt: string | null
  resolution: string | null
  minutesToResolve: number | null
  officerName: string
  /** The incident happened on a later calendar day than the shift started (Night shift after midnight). */
  afterMidnight: boolean
  canEdit: boolean
  createdAt: string
  updatedAt: string
  attachments: IncidentAttachmentDto[]
  events: IncidentEventDto[]
}

export interface UploadResultDto { attachments: IncidentAttachmentDto[] }

export interface PeriodDelta { current: number | null; previous: number | null }
export interface IncidentSummaryDto {
  previousFrom: string
  previousTo: string
  total: PeriodDelta
  avgMinutesToResolve: PeriodDelta
  escalatedOnTimePct: PeriodDelta
  openCriticalHigh: number
  openCriticalHighOver24h: number
}
export interface TrendPointDto { bucket: string; LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number; total: number; movingAvg: number | null }
export interface IncidentTrendDto { granularity: 'day' | 'week'; points: TrendPointDto[] }
/** `key` is a severity code or a lookup id as a string. */
export interface CountByDto { key: string; label: string; count: number }
export interface HotspotDto { locationId: number; location: string; count: number; topCategory: string | null }
export interface DayNightPointDto { weekStart: string; counts: Record<string, number> }
export interface DayNightDto { shifts: { code: string; name: string }[]; points: DayNightPointDto[] }
export interface AttentionItemDto {
  id: number
  ref: string
  occurredAt: string
  location: string
  category: string
  severity: Severity
  status: IncidentStatus
  reasons: string[]
}
