import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'

async function makeDefinitionAndUsers() {
  const def = await prisma.shiftDefinition.create({ data: { code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00', sortOrder: 1 } })
  const a = await prisma.user.create({ data: { fullName: 'Antony Ochieng', email: 'a@test.local', passwordHash: 'x', role: 'OFFICER' } })
  const b = await prisma.user.create({ data: { fullName: 'Simon Gatungo', email: 'b@test.local', passwordHash: 'x', role: 'OFFICER' } })
  return { def, a, b }
}

const day = new Date('2026-09-30T00:00:00Z')

describe('database schema', () => {
  beforeEach(resetDb)
  afterAll(() => prisma.$disconnect())

  it('stores a roster row and reads the date back unchanged', async () => {
    const { def, a, b } = await makeDefinitionAndUsers()
    const s = await prisma.shift.create({ data: { shiftDate: day, shiftDefinitionId: def.id, startsAt: new Date('2026-09-30T05:00:00Z'), endsAt: new Date('2026-09-30T14:00:00Z'), supervisorId: a.id, officerId: b.id } })
    const back = await prisma.shift.findUniqueOrThrow({ where: { id: s.id } })
    expect(back.shiftDate.toISOString()).toBe('2026-09-30T00:00:00.000Z')
    expect(back.startsAt.toISOString()).toBe('2026-09-30T05:00:00.000Z')
  })

  it('rejects a shift where supervisor and officer are the same person', async () => {
    const { def, a } = await makeDefinitionAndUsers()
    await expect(
      prisma.shift.create({ data: { shiftDate: day, shiftDefinitionId: def.id, startsAt: new Date(), endsAt: new Date(), supervisorId: a.id, officerId: a.id } }),
    ).rejects.toThrow()
  })

  it('rejects a second roster row for the same date and shift', async () => {
    const { def, a, b } = await makeDefinitionAndUsers()
    const data = { shiftDate: day, shiftDefinitionId: def.id, startsAt: new Date(), endsAt: new Date(), supervisorId: a.id, officerId: b.id }
    await prisma.shift.create({ data })
    await expect(prisma.shift.create({ data })).rejects.toMatchObject({ code: 'P2002' })
  })
})
