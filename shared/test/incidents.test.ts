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

  it('rejects ids beyond the database integer range', () => {
    const r = incidentInputSchema.safeParse({ ...base, side: 'MOBILE', locationId: null, locationText: 'Mlolongo', vehicleId: 2147483648 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'vehicleId')).toBe(true)
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

  it('parses side and mobile filters', () => {
    const q = incidentQuerySchema.parse({ side: 'MOBILE', vehicleId: '7,8', platformId: '2', gpsStatus: 'OFFLINE,UNKNOWN', sort: '-side' })
    expect(q).toMatchObject({ side: 'MOBILE', vehicleId: [7, 8], platformId: [2], gpsStatus: ['OFFLINE', 'UNKNOWN'], sort: '-side' })
    expect(incidentQuerySchema.safeParse({ side: 'BOTH' }).success).toBe(false)
    expect(incidentQuerySchema.safeParse({ dashcamStatus: 'BROKEN' }).success).toBe(false)
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

describe('incidentInputSchema — weighbridge sides', () => {
  const common = { occurredAt: '2026-09-30T22:15:00.000Z', categoryId: 5, severity: 'HIGH', description: 'Camera offline', status: 'OPEN' }
  const mobile = { ...common, side: 'MOBILE', vehicleId: 7, locationText: 'Mlolongo', vehicleStatus: 'ONLINE', gpsStatus: 'ONLINE', dashcamStatus: 'OFFLINE', platformId: 2 }

  it('treats input without a side as a static incident', () => {
    const r = incidentInputSchema.parse({ ...common, locationId: 3 })
    expect(r.side).toBe('STATIC')
  })

  it('accepts a mobile incident with the mobile sheet fields', () => {
    const r = incidentInputSchema.parse({ ...mobile, remarks: '  CH3 rainbow  ' })
    expect(r).toMatchObject({ side: 'MOBILE', vehicleId: 7, locationId: null, locationText: 'Mlolongo', remarks: 'CH3 rainbow' })
  })

  it('names each missing mobile field the way the sheet does', () => {
    const r = incidentInputSchema.safeParse({ ...common, side: 'MOBILE' })
    expect(r.success).toBe(false)
    const fields = Object.fromEntries(r.error!.issues.map((i) => [i.path.join('.'), i.message]))
    expect(fields.vehicleId).toBe('Choose the vehicle / unit')
    expect(fields.vehicleStatus).toBe('Choose the vehicle status')
    expect(fields.gpsStatus).toBe('Choose the GPS status')
    expect(fields.dashcamStatus).toBe('Choose the dashcam status')
    expect(fields.platformId).toBe('Choose the platform')
  })

  it('needs exactly one of a listed or typed place for mobile incidents', () => {
    const neither = incidentInputSchema.safeParse({ ...mobile, locationText: null })
    expect(neither.error?.issues.map((i) => i.message)).toContain('Enter where the unit is')
    const both = incidentInputSchema.safeParse({ ...mobile, locationId: 3 })
    expect(both.error?.issues.map((i) => i.message)).toContain('Pick a listed place or type one, not both')
    expect(incidentInputSchema.safeParse({ ...mobile, locationText: null, locationId: 3 }).success).toBe(true)
  })

  it("rejects the other side's fields", () => {
    const staticWithVehicle = incidentInputSchema.safeParse({ ...common, locationId: 3, vehicleId: 7 })
    expect(staticWithVehicle.error?.issues[0]).toMatchObject({ path: ['vehicleId'], message: 'Only for mobile weighbridge incidents' })
    const mobileWithDetail = incidentInputSchema.safeParse({ ...mobile, locationDetail: 'Camera 4' })
    expect(mobileWithDetail.error?.issues[0]).toMatchObject({ path: ['locationDetail'], message: 'Only for static weighbridge incidents' })
  })
})
