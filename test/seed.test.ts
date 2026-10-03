import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('falls back per setting and warns when a stored value is invalid', async () => {
    await seedDefaults(prisma)
    await prisma.systemSetting.update({ where: { key: 'ddEmails' }, data: { value: '["not-an-email"]' } })
    await prisma.systemSetting.update({ where: { key: 'reportDeadlineMinutes' }, data: { value: '45' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const settings = await getSettings()
    expect(settings.ddEmails).toEqual([])
    expect(settings.reportDeadlineMinutes).toBe(45)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ddEmails'))
    warn.mockRestore()
  })
})
