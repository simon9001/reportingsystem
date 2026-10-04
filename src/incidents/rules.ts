import { INCIDENT_STATUS_LABELS, RESOLVED_STATUSES, type EscalationResult, type IncidentEventKind, type IncidentStatus } from '@sr/shared'

export interface EscalationRuleLike { isRequired: boolean; withinMinutes: number | null }
export interface ComputedIncidentFields { minutesToResolve: number | null; escalationResult: EscalationResult; escalationMinutes: number | null }

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000)

/** System spec §4.4 escalation check plus time-to-resolve. */
export function computeIncidentFields(
  i: { occurredAt: Date; escalatedTo: string | null; escalatedAt: Date | null; resolvedAt: Date | null },
  rule: EscalationRuleLike | null,
): ComputedIncidentFields {
  const minutesToResolve = i.resolvedAt ? minutesBetween(i.occurredAt, i.resolvedAt) : null
  const escalationMinutes = i.escalatedTo && i.escalatedAt ? minutesBetween(i.occurredAt, i.escalatedAt) : null
  let escalationResult: EscalationResult
  if (!rule?.isRequired) escalationResult = 'NOT_REQUIRED'
  else if (!i.escalatedTo) escalationResult = 'NOT_ESCALATED'
  else if (rule.withinMinutes !== null && escalationMinutes !== null) escalationResult = escalationMinutes <= rule.withinMinutes ? 'ON_TIME' : 'LATE'
  else escalationResult = 'ESCALATED'
  return { minutesToResolve, escalationResult, escalationMinutes }
}

export const isResolvedStatus = (s: IncidentStatus) => (RESOLVED_STATUSES as readonly string[]).includes(s)

export interface ShiftPeople { id: number; supervisorId: number; officerId: number }

/** Officers: only shifts they are rostered on that are current or immediately previous. Admin: always. Others: never. */
export function canEditIncident(actor: { id: number; role: string }, shift: ShiftPeople, editableShiftIds: readonly number[]): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role !== 'OFFICER') return false
  const onShift = shift.supervisorId === actor.id || shift.officerId === actor.id
  return onShift && editableShiftIds.includes(shift.id)
}

export interface IncidentSnapshot {
  occurredAt: string
  locationId: number | null
  locationDetail: string | null
  categoryId: number
  severity: string
  description: string
  immediateAction: string | null
  escalatedTo: string | null
  escalatedAt: string | null
  assignedTo: string | null
  status: IncidentStatus
  resolvedAt: string | null
  resolution: string | null
}

const FIELD_LABELS: Record<keyof IncidentSnapshot, string> = {
  occurredAt: 'time',
  locationId: 'location',
  locationDetail: 'location detail',
  categoryId: 'category',
  severity: 'severity',
  description: 'description',
  immediateAction: 'immediate action',
  escalatedTo: 'escalation',
  escalatedAt: 'escalation time',
  assignedTo: 'assigned to',
  status: 'status',
  resolvedAt: 'resolution time',
  resolution: 'resolution',
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

export function escalationSummary(to: string, atIso: string | null, fmtTime: (iso: string) => string): string {
  return truncate(atIso ? `Escalated to ${to} at ${fmtTime(atIso)}` : `Escalated to ${to}`, 300)
}

export function buildUpdateEvents(
  before: IncidentSnapshot,
  after: IncidentSnapshot,
  fmtTime: (iso: string) => string,
): { kind: IncidentEventKind; summary: string }[] {
  const events: { kind: IncidentEventKind; summary: string }[] = []
  const handled = new Set<keyof IncidentSnapshot>(['status', 'escalatedTo', 'escalatedAt'])
  if (before.status !== after.status) {
    if (isResolvedStatus(after.status) && !isResolvedStatus(before.status)) {
      events.push({ kind: 'RESOLVED', summary: truncate(after.resolution ? `Resolved: ${after.resolution}` : 'Resolved', 300) })
      handled.add('resolvedAt').add('resolution')
    } else {
      events.push({ kind: 'STATUS_CHANGED', summary: `Status changed from ${INCIDENT_STATUS_LABELS[before.status]} to ${INCIDENT_STATUS_LABELS[after.status]}` })
    }
  }
  if (after.escalatedTo && (after.escalatedTo !== before.escalatedTo || after.escalatedAt !== before.escalatedAt)) {
    events.push({ kind: 'ESCALATED', summary: escalationSummary(after.escalatedTo, after.escalatedAt, fmtTime) })
  }
  if (before.escalatedTo && !after.escalatedTo) events.push({ kind: 'UPDATED', summary: 'Escalation removed' })
  const changed = (Object.keys(FIELD_LABELS) as (keyof IncidentSnapshot)[]).filter((k) => !handled.has(k) && before[k] !== after[k])
  if (changed.length > 0) events.push({ kind: 'UPDATED', summary: truncate(`Updated ${changed.map((k) => FIELD_LABELS[k]).join(', ')}`, 300) })
  return events
}
