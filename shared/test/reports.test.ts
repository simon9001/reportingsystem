import { describe, expect, it } from 'vitest'
import { LIVE_TOPICS, reportQuerySchema, reportSubmitProblems, reportUpdateSchema, type ReportFieldsDto } from '../src'

const empty: ReportFieldsDto = {
  overallStatus: null, overview: null, keyEvents: null, pendingActions: null, operationalConcerns: null, recommendations: null,
  confirmReviewed: false, confirmEscalated: false, confirmHandedOver: false, confirmSubmitted: false,
}

describe('report contract', () => {
  it('has a live topic for reports', () => expect(LIVE_TOPICS).toContain('reports'))

  it('trims text, stores empty text as null and requires updatedAt', () => {
    const r = reportUpdateSchema.parse({ overview: '  Quiet night  ', keyEvents: '   ', updatedAt: '2026-10-11T05:00:00.000Z' })
    expect(r.overview).toBe('Quiet night')
    expect(r.keyEvents).toBeNull()
    expect(reportUpdateSchema.safeParse({ overview: 'x' }).success).toBe(false)
  })

  it('caps text at 4000 characters and checks the overall status', () => {
    const at = '2026-10-11T05:00:00.000Z'
    expect(reportUpdateSchema.safeParse({ overview: 'a'.repeat(4000), updatedAt: at }).success).toBe(true)
    expect(reportUpdateSchema.safeParse({ overview: 'a'.repeat(4001), updatedAt: at }).success).toBe(false)
    expect(reportUpdateSchema.safeParse({ overallStatus: 'FINE', updatedAt: at }).success).toBe(false)
  })

  it('lists what blocks submitting', () => {
    expect(Object.keys(reportSubmitProblems(empty)).sort()).toEqual(
      ['confirmEscalated', 'confirmHandedOver', 'confirmReviewed', 'confirmSubmitted', 'overallStatus', 'overview'],
    )
    const ready = { ...empty, overallStatus: 'NORMAL' as const, overview: 'All calm', confirmReviewed: true, confirmEscalated: true, confirmHandedOver: true, confirmSubmitted: true }
    expect(reportSubmitProblems(ready)).toEqual({})
  })

  it('accepts derived OVERDUE in the archive query', () => {
    expect(reportQuerySchema.parse({ status: 'OVERDUE', page: '2' })).toMatchObject({ status: 'OVERDUE', page: 2 })
    expect(reportQuerySchema.safeParse({ status: 'LOST' }).success).toBe(false)
  })
})
