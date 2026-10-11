import {
  ESCALATION_RESULTS, INCIDENT_SIDES, INCIDENT_STATUSES, OUTSTANDING_STATUSES, SEVERITIES, SEVERITY_LABELS,
  type ReportCheckDto, type ReportContentDto, type ReportFieldsDto, type ReportIncidentRowDto, type ReportShiftDto, type ReportTimeliness,
} from '@sr/shared'

export interface ReportIncidentInput extends ReportIncidentRowDto {
  minutesToResolve: number | null
  description: string
}

const MINUTE = 60_000
const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>

export const reportDeadline = (endsAt: Date, deadlineMinutes: number) => new Date(endsAt.getTime() + deadlineMinutes * MINUTE)

/** ON_TIME up to and including the deadline; LATE by whole minutes, rounded up. */
export function computeTimeliness(submittedAt: Date, endsAt: Date, deadlineMinutes: number): { timeliness: ReportTimeliness; lateMinutes: number | null } {
  const over = submittedAt.getTime() - reportDeadline(endsAt, deadlineMinutes).getTime()
  return over <= 0 ? { timeliness: 'ON_TIME', lateMinutes: null } : { timeliness: 'LATE', lateMinutes: Math.ceil(over / MINUTE) }
}

const toRow = ({ minutesToResolve: _m, description: _d, ...row }: ReportIncidentInput): ReportIncidentRowDto => row

export function buildReportContent(
  shift: ReportShiftDto,
  incidents: ReportIncidentInput[],
  deadlineMinutes: number,
  fields: Pick<ReportFieldsDto, 'overview' | 'pendingActions'>,
): ReportContentDto {
  const sorted = [...incidents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.ref.localeCompare(b.ref))
  const bySeverity = zero(SEVERITIES)
  const byStatus = zero(INCIDENT_STATUSES)
  const bySide = zero(INCIDENT_SIDES)
  const escalation = zero(ESCALATION_RESULTS)
  const categories = new Map<string, number>()
  for (const i of sorted) {
    bySeverity[i.severity] += 1
    byStatus[i.status] += 1
    bySide[i.side] += 1
    escalation[i.escalationResult] += 1
    categories.set(i.category, (categories.get(i.category) ?? 0) + 1)
  }
  const resolved = sorted.filter((i) => i.minutesToResolve !== null)
  const avgMinutesToResolve = resolved.length ? Math.round(resolved.reduce((s, i) => s + i.minutesToResolve!, 0) / resolved.length) : null
  const isOpen = (i: ReportIncidentInput) => OUTSTANDING_STATUSES.includes(i.status)
  const open = sorted.filter(isOpen)
  const criticalHigh = sorted.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH')

  const checks: ReportCheckDto[] = []
  for (const i of criticalHigh) {
    if (i.escalationResult === 'NOT_ESCALATED' || i.escalationResult === 'LATE') {
      const how = i.escalationResult === 'LATE' ? 'was escalated late' : 'was not escalated'
      checks.push({ code: 'NOT_ESCALATED', message: `${i.ref} is ${SEVERITY_LABELS[i.severity]} and ${how}`, ref: i.ref })
    }
  }
  for (const i of sorted) {
    if (!i.description.trim()) checks.push({ code: 'EMPTY_DESCRIPTION', message: `${i.ref} has no description`, ref: i.ref })
  }
  if (open.length > 0 && !fields.pendingActions?.trim()) {
    const n = open.length
    checks.push({ code: 'OPEN_WITHOUT_PENDING_ACTIONS', message: `${n} incident${n === 1 ? ' is' : 's are'} still open — list ${n === 1 ? 'it' : 'them'} under Pending actions for next shift`, ref: null })
  }
  if (sorted.length === 0 && !fields.overview?.trim()) {
    checks.push({ code: 'QUIET_WITHOUT_OVERVIEW', message: 'No incidents were logged — confirm the shift was quiet in the overview', ref: null })
  }

  return {
    shift,
    deadline: reportDeadline(new Date(shift.endsAt), deadlineMinutes).toISOString(),
    figures: {
      total: sorted.length,
      bySeverity,
      byStatus,
      bySide,
      byCategory: [...categories].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      escalation,
      avgMinutesToResolve,
      openAtEnd: open.length,
    },
    criticalHigh: criticalHigh.map(toRow),
    open: open.map(toRow),
    incidents: sorted.map(toRow),
    checks,
  }
}
