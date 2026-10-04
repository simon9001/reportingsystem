export const DEFAULT_TIMEZONE = 'Africa/Nairobi'

export const ROLES = ['ADMIN', 'DEPUTY_DIRECTOR', 'OFFICER'] as const
export type Role = (typeof ROLES)[number]
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  DEPUTY_DIRECTOR: 'Deputy Director',
  OFFICER: 'Control Room Officer',
}

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type Severity = (typeof SEVERITIES)[number]
export const SEVERITY_LABELS: Record<Severity, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' }

export const LOOKUP_TYPES = ['CATEGORY', 'SYSTEM', 'TEAM', 'PLATFORM', 'LOCATION'] as const
export type LookupType = (typeof LOOKUP_TYPES)[number]
export const LOOKUP_TYPE_LABELS: Record<LookupType, string> = {
  CATEGORY: 'Incident categories',
  SYSTEM: 'Systems / equipment',
  TEAM: 'Responsible teams',
  PLATFORM: 'Monitoring platforms',
  LOCATION: 'Locations',
}

export const SHIFT_ROLES = ['SUPERVISOR', 'OFFICER'] as const
export type ShiftRole = (typeof SHIFT_ROLES)[number]

export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'SUBMIT'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const INCIDENT_STATUSES = ['OPEN', 'IN_PROGRESS', 'MONITORING', 'RESOLVED', 'CLOSED'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  MONITORING: 'Monitoring',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}
export const OUTSTANDING_STATUSES: readonly IncidentStatus[] = ['OPEN', 'IN_PROGRESS', 'MONITORING']
export const RESOLVED_STATUSES: readonly IncidentStatus[] = ['RESOLVED', 'CLOSED']
export const SEVERITY_RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }

export const ESCALATION_RESULTS = ['NOT_REQUIRED', 'NOT_ESCALATED', 'ESCALATED', 'ON_TIME', 'LATE'] as const
export type EscalationResult = (typeof ESCALATION_RESULTS)[number]
export const ESCALATION_RESULT_LABELS: Record<EscalationResult, string> = {
  NOT_REQUIRED: 'Not required',
  NOT_ESCALATED: 'Not escalated',
  ESCALATED: 'Escalated',
  ON_TIME: 'On time',
  LATE: 'Late',
}

export const INCIDENT_EVENT_KINDS = ['CREATED', 'UPDATED', 'STATUS_CHANGED', 'ESCALATED', 'RESOLVED', 'ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED'] as const
export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number]

export const LIVE_TOPICS = ['incidents', 'roster', 'users', 'config', 'audit', 'shift'] as const
export type LiveTopic = (typeof LIVE_TOPICS)[number]

export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_INCIDENT = 10
