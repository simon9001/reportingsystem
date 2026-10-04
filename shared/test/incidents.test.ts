import { describe, expect, it } from 'vitest'
import { analyticsQuerySchema, incidentInputSchema, incidentQuerySchema } from '../src'

const base = {
  occurredAt: '2026-09-30T22:15:00.000Z',
  locationId: 1,
  categoryId: 2,
  severity: 'HIGH',
  description: 'Camera WB04 went offline',
  status: 'OPEN',
}

describe('incidentInputSchema', () => {
  it('accepts a minimal incident and turns empty optional text into null', () => {
    const r = incidentInputSchema.parse({ ...base, immediateAction: '  ', escalatedTo: '' })
    expect(r.immediateAction).toBeNull()
    expect(r.escalatedTo).toBeNull()
    expect(r.resolvedAt).toBeNull()
  })

  it('requires a resolved time for Resolved/Closed and rejects times before the incident', () => {
    const missing = incidentInputSchema.safeParse({ ...base, status: 'RESOLVED' })
    expect(missing.success).toBe(false)
    if (!missing.success) expect(missing.error.issues[0]?.path).toEqual(['resolvedAt'])
    const early = incidentInputSchema.safeParse({ ...base, status: 'CLOSED', resolvedAt: '2026-09-30T22:00:00.000Z' })
    expect(early.success).toBe(false)
    const escalatedEarly = incidentInputSchema.safeParse({ ...base, escalatedTo: 'ICT', escalatedAt: '2026-09-30T21:00:00.000Z' })
    expect(escalatedEarly.success).toBe(false)
  })

  it('requires who was notified when an escalation time is given', () => {
    const r = incidentInputSchema.safeParse({ ...base, escalatedAt: '2026-09-30T22:30:00.000Z' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['escalatedTo'])
  })

  it('requires a description of at least 3 characters', () => {
    expect(incidentInputSchema.safeParse({ ...base, description: 'x' }).success).toBe(false)
  })
})

describe('incidentQuerySchema', () => {
  it('parses comma-separated multi filters and defaults', () => {
    const q = incidentQuerySchema.parse({ severity: 'HIGH,CRITICAL', categoryId: '3,4', from: '2026-08-30', to: '2026-08-30' })
    expect(q.severity).toEqual(['HIGH', 'CRITICAL'])
    expect(q.categoryId).toEqual([3, 4])
    expect(q.sort).toBe('-occurredAt')
    expect(q.page).toBe(1)
    expect(q.pageSize).toBe(25)
  })

  it('rejects bad values', () => {
    expect(incidentQuerySchema.safeParse({ severity: 'URGENT' }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ pageSize: '30' }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-01' }).success).toBe(false)
  })

  it('bounds id filters to the database int range and caps the page number', () => {
    const tooBig = '2147483648'
    expect(incidentQuerySchema.safeParse({ shiftId: tooBig }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ reportedById: tooBig }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ categoryId: `3,${tooBig}` }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ locationId: tooBig }).success).toBe(false)
    expect(incidentQuerySchema.parse({ shiftId: '2147483647', categoryId: '2147483647' })).toMatchObject({ shiftId: 2147483647, categoryId: [2147483647] })
    expect(incidentQuerySchema.parse({ page: '100000' }).page).toBe(100000)
    expect(incidentQuerySchema.safeParse({ page: '100001' }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ page: '1e300' }).success).toBe(false)
  })
})

describe('analyticsQuerySchema', () => {
  it('requires an ordered period of at most one year', () => {
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(true)
    expect(analyticsQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(false)
    expect(analyticsQuerySchema.safeParse({ from: '2025-01-01', to: '2026-09-30' }).success).toBe(false)
  })
})
