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

export const LIVE_TOPICS = ['incidents', 'roster', 'users', 'config', 'audit', 'shift', 'reports'] as const
export type LiveTopic = (typeof LIVE_TOPICS)[number]

export const ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_INCIDENT = 10

export const INCIDENT_SIDES = ['STATIC', 'MOBILE'] as const
export type IncidentSide = (typeof INCIDENT_SIDES)[number]
export const INCIDENT_SIDE_LABELS: Record<IncidentSide, string> = { STATIC: 'Static weighbridge', MOBILE: 'Mobile weighbridge' }
export const INCIDENT_SIDE_SHORT: Record<IncidentSide, string> = { STATIC: 'Static', MOBILE: 'Mobile' }
export const INCIDENT_REF_PREFIX: Record<IncidentSide, 'INC' | 'MWB'> = { STATIC: 'INC', MOBILE: 'MWB' }

export const VEHICLE_STATUSES = ['MOVING', 'IDLING', 'ONLINE', 'OFFLINE'] as const
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number]
export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = { MOVING: 'Moving', IDLING: 'Idling', ONLINE: 'Online', OFFLINE: 'Offline' }

export const LINK_STATUSES = ['ONLINE', 'OFFLINE', 'UNKNOWN'] as const
export type LinkStatus = (typeof LINK_STATUSES)[number]
export const LINK_STATUS_LABELS: Record<LinkStatus, string> = { ONLINE: 'Online', OFFLINE: 'Offline', UNKNOWN: 'Unknown' }

export const OVERALL_STATUSES = ['NORMAL', 'MINOR_ISSUES', 'MAJOR_ISSUES'] as const
export type OverallStatus = (typeof OVERALL_STATUSES)[number]
export const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = { NORMAL: 'Normal', MINOR_ISSUES: 'Minor issues', MAJOR_ISSUES: 'Major issues' }

export const REPORT_STATUSES = ['DRAFT', 'SUBMITTED'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]
export const REPORT_TIMELINESS = ['ON_TIME', 'LATE'] as const
export type ReportTimeliness = (typeof REPORT_TIMELINESS)[number]

export const REPORT_TEXT_MAX = 4000
export const REPORT_TEXT_FIELDS = ['overview', 'keyEvents', 'pendingActions', 'operationalConcerns', 'recommendations'] as const
export type ReportTextField = (typeof REPORT_TEXT_FIELDS)[number]
export const REPORT_TEXT_LABELS: Record<ReportTextField, string> = {
  overview: 'Shift overview',
  keyEvents: 'Key events',
  pendingActions: 'Pending actions for next shift',
  operationalConcerns: 'Operational concerns',
  recommendations: 'Recommendations',
}
export const REPORT_CONFIRMATIONS = [
  { key: 'confirmReviewed', label: 'All incidents for this shift have been reviewed and are complete' },
  { key: 'confirmEscalated', label: 'All critical and high incidents were escalated' },
  { key: 'confirmHandedOver', label: 'Outstanding items have been handed over to the next shift' },
  { key: 'confirmSubmitted', label: 'This report is submitted to management' },
] as const
export type ReportConfirmation = (typeof REPORT_CONFIRMATIONS)[number]['key']

export const EMAIL_JOB_TYPES = ['REPORT_SUBMITTED', 'REPORT_OVERDUE_DD', 'REPORT_OVERDUE_SUPERVISOR', 'TEST'] as const
export type EmailJobType = (typeof EMAIL_JOB_TYPES)[number]
export const EMAIL_JOB_TYPE_LABELS: Record<EmailJobType, string> = {
  REPORT_SUBMITTED: 'Report submitted',
  REPORT_OVERDUE_DD: 'Report overdue (Deputy Director)',
  REPORT_OVERDUE_SUPERVISOR: 'Report overdue (supervisor reminder)',
  TEST: 'Test email',
}
export const EMAIL_JOB_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED_NO_SMTP', 'SKIPPED_NO_RECIPIENT', 'SKIPPED_SUBMITTED'] as const
export type EmailJobStatus = (typeof EMAIL_JOB_STATUSES)[number]
export const EMAIL_JOB_STATUS_LABELS: Record<EmailJobStatus, string> = {
  PENDING: 'Waiting',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  SKIPPED_NO_SMTP: 'Skipped — SMTP not configured',
  SKIPPED_NO_RECIPIENT: 'Skipped — no recipient',
  SKIPPED_SUBMITTED: 'Skipped — report already submitted',
}
