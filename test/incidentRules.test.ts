import { describe, expect, it } from 'vitest'
import { buildUpdateEvents, canEditIncident, computeIncidentFields, type IncidentSnapshot } from '../src/incidents/rules'
import { formatIncidentRef } from '../src/incidents/sequence'

const at = (hhmm: string) => new Date(`2026-09-29T${hhmm}:00+03:00`)

describe('computeIncidentFields', () => {
  it('matches the manual example: escalated in 15 min (allowed 30) and resolved in 55 min', () => {
    const r = computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: 'ICT Officer', escalatedAt: at('01:30'), resolvedAt: at('02:10') }, { isRequired: true, withinMinutes: 30 })
    expect(r).toEqual({ minutesToResolve: 55, escalationResult: 'ON_TIME', escalationMinutes: 15 })
  })

  it('flags late, missing and untimed escalations', () => {
    const rule = { isRequired: true, withinMinutes: 30 }
    expect(computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: 'ICT', escalatedAt: at('02:00'), resolvedAt: null }, rule).escalationResult).toBe('LATE')
    expect(computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: null, escalatedAt: null, resolvedAt: null }, rule).escalationResult).toBe('NOT_ESCALATED')
    expect(computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: 'ICT', escalatedAt: null, resolvedAt: null }, rule).escalationResult).toBe('ESCALATED')
    expect(computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: 'ICT', escalatedAt: at('02:00'), resolvedAt: null }, { isRequired: true, withinMinutes: null }).escalationResult).toBe('ESCALATED')
  })

  it('does not require escalation when the rule says so or is missing', () => {
    expect(computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: null, escalatedAt: null, resolvedAt: null }, { isRequired: false, withinMinutes: null }).escalationResult).toBe('NOT_REQUIRED')
    expect(computeIncidentFields({ occurredAt: at('01:15'), escalatedTo: null, escalatedAt: null, resolvedAt: null }, null).escalationResult).toBe('NOT_REQUIRED')
  })
})

describe('canEditIncident', () => {
  const shift = { id: 10, supervisorId: 1, officerId: 2 }
  it('lets rostered officers edit only current/previous shifts, admins always, others never', () => {
    expect(canEditIncident({ id: 1, role: 'OFFICER' }, shift, [10, 9])).toBe(true)
    expect(canEditIncident({ id: 2, role: 'OFFICER' }, shift, [10])).toBe(true)
    expect(canEditIncident({ id: 1, role: 'OFFICER' }, shift, [11, 12])).toBe(false)
    expect(canEditIncident({ id: 3, role: 'OFFICER' }, shift, [10])).toBe(false)
    expect(canEditIncident({ id: 4, role: 'DEPUTY_DIRECTOR' }, shift, [10])).toBe(false)
    expect(canEditIncident({ id: 5, role: 'ADMIN' }, shift, [])).toBe(true)
  })
})

describe('buildUpdateEvents', () => {
  const before: IncidentSnapshot = {
    occurredAt: '2026-09-28T22:15:00.000Z', locationId: 1, locationDetail: null, categoryId: 2, severity: 'HIGH',
    description: 'Camera offline', immediateAction: null, escalatedTo: null, escalatedAt: null, assignedTo: null,
    status: 'OPEN', resolvedAt: null, resolution: null,
  }
  const fmt = (iso: string) => iso.slice(11, 16)

  it('records resolution, escalation and other field changes as separate entries', () => {
    const events = buildUpdateEvents(before, {
      ...before, severity: 'CRITICAL', escalatedTo: 'ICT Officer', escalatedAt: '2026-09-28T22:30:00.000Z',
      status: 'RESOLVED', resolvedAt: '2026-09-28T23:10:00.000Z', resolution: 'Restored',
    }, fmt)
    expect(events).toEqual([
      { kind: 'RESOLVED', summary: 'Resolved: Restored' },
      { kind: 'ESCALATED', summary: 'Escalated to ICT Officer at 22:30' },
      { kind: 'UPDATED', summary: 'Updated severity' },
    ])
  })

  it('records a plain status change and nothing when nothing changed', () => {
    expect(buildUpdateEvents(before, { ...before, status: 'IN_PROGRESS' }, fmt)).toEqual([{ kind: 'STATUS_CHANGED', summary: 'Status changed from Open to In progress' }])
    expect(buildUpdateEvents(before, { ...before }, fmt)).toEqual([])
  })

  it('records when an escalation is removed', () => {
    const escalated = { ...before, escalatedTo: 'ICT Officer', escalatedAt: '2026-09-28T22:30:00.000Z' }
    const events = buildUpdateEvents(escalated, { ...escalated, escalatedTo: null, escalatedAt: null }, fmt)
    expect(events).toContainEqual({ kind: 'UPDATED', summary: 'Escalation removed' })
  })
})

describe('formatIncidentRef', () => {
  it('zero-pads to four digits', () => {
    expect(formatIncidentRef(2026, 7)).toBe('INC-2026-0007')
    expect(formatIncidentRef(2026, 12345)).toBe('INC-2026-12345')
  })
})
