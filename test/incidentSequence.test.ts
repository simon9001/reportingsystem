import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { nextIncidentRef } from '../src/incidents/sequence'
import { resetDb } from './db'

const SEPT = new Date('2026-09-30T08:00:00.000Z')
const next = (side?: 'STATIC' | 'MOBILE') => prisma.$transaction((tx) => nextIncidentRef(tx, SEPT, side))

describe('incident numbering', () => {
  beforeEach(() => resetDb())
  afterAll(() => prisma.$disconnect())

  it('keeps separate counters for static (INC) and mobile (MWB) incidents', async () => {
    expect(await next('STATIC')).toBe('INC-2026-0001')
    expect(await next('MOBILE')).toBe('MWB-2026-0001')
    expect(await next('MOBILE')).toBe('MWB-2026-0002')
    expect(await next()).toBe('INC-2026-0002')
  })

  it('continues the existing static counter after the migration', async () => {
    await prisma.incidentSequence.create({ data: { prefix: 'INC', year: 2026, lastNumber: 7 } })
    expect(await next('STATIC')).toBe('INC-2026-0008')
    expect(await next('MOBILE')).toBe('MWB-2026-0001')
  })

  it('never hands out the same mobile number twice under concurrency', async () => {
    const refs = await Promise.all(Array.from({ length: 5 }, () => next('MOBILE')))
    expect(new Set(refs).size).toBe(5)
  })
})
