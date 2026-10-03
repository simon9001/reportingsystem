import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getSettings } from '../src/config/settings'
import { seedDefaults } from '../src/config/seedDefaults'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'

describe('seedDefaults', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('creates the Day/Night shifts, escalation rules, lists and settings', async () => {
    await seedDefaults(prisma)
    const defs = await prisma.shiftDefinition.findMany({ orderBy: { sortOrder: 'asc' } })
    expect(defs.map((d) => [d.code, d.startTime, d.endTime])).toEqual([['DAY', '08:00', '17:00'], ['NIGHT', '17:00', '08:00']])
    expect(await prisma.escalationRule.count()).toBe(4)
    expect(await prisma.lookupItem.count({ where: { listType: 'SYSTEM' } })).toBe(8)
    expect((await getSettings()).reportDeadlineMinutes).toBe(30)
  })

  it('is idempotent and keeps admin changes', async () => {
    await seedDefaults(prisma)
    await prisma.escalationRule.update({ where: { severity: 'HIGH' }, data: { withinMinutes: 20 } })
    await seedDefaults(prisma)
    expect(await prisma.shiftDefinition.count()).toBe(2)
    expect((await prisma.escalationRule.findUniqueOrThrow({ where: { severity: 'HIGH' } })).withinMinutes).toBe(20)
  })
})
