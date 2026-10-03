import { localDateString } from '@sr/shared'
import { seedDefaults } from '../src/config/seedDefaults'
import { env } from '../src/lib/env'
import { prisma } from '../src/lib/prisma'
import { createUser } from './factories'

const HOUR = 3_600_000

async function makeShift(code: 'DAY' | 'NIGHT', shiftDate: string, startsAt: Date, endsAt: Date, supervisorId: number, officerId: number) {
  const def = await prisma.shiftDefinition.findUniqueOrThrow({ where: { code } })
  return prisma.shift.create({
    data: { shiftDate: new Date(`${shiftDate}T00:00:00Z`), shiftDefinitionId: def.id, startsAt, endsAt, supervisorId, officerId },
  })
}

/** current shift = now-2h..now+6h; previous = now-14h..now-2h; older = now-26h..now-14h; gap before that. */
export async function setupIncidentWorld(now = new Date()) {
  await seedDefaults(prisma)
  const supervisor = await createUser('OFFICER', { fullName: 'Antony Ochieng' })
  const officer = await createUser('OFFICER', { fullName: 'Simon Gatungo' })
  const otherOfficer = await createUser('OFFICER', { fullName: 'Peter Kamau' })
  const today = localDateString(now, env.SR_APP_TIMEZONE)
  const yesterday = localDateString(new Date(now.getTime() - 24 * HOUR), env.SR_APP_TIMEZONE)
  const older2 = localDateString(new Date(now.getTime() - 48 * HOUR), env.SR_APP_TIMEZONE)
  const current = await makeShift('DAY', today, new Date(now.getTime() - 2 * HOUR), new Date(now.getTime() + 6 * HOUR), supervisor.id, officer.id)
  const previous = await makeShift('NIGHT', yesterday, new Date(now.getTime() - 14 * HOUR), new Date(now.getTime() - 2 * HOUR), officer.id, supervisor.id)
  const older = await makeShift('DAY', older2, new Date(now.getTime() - 26 * HOUR), new Date(now.getTime() - 14 * HOUR), supervisor.id, officer.id)
  const location = await prisma.lookupItem.findFirstOrThrow({ where: { listType: 'LOCATION', value: 'Weighbridge 04' } })
  const category = await prisma.lookupItem.findFirstOrThrow({ where: { listType: 'CATEGORY', value: 'CCTV' } })
  const inactiveCategory = await prisma.lookupItem.update({ where: { listType_value: { listType: 'CATEGORY', value: 'Other' } }, data: { isActive: false } })
  return { supervisor, officer, otherOfficer, current, previous, older, location, category, inactiveCategory }
}

export function incidentBody(world: Awaited<ReturnType<typeof setupIncidentWorld>>, overrides: Record<string, unknown> = {}) {
  return {
    occurredAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    locationId: world.location.id,
    categoryId: world.category.id,
    severity: 'HIGH',
    description: 'Camera WB04 went offline',
    status: 'OPEN',
    ...overrides,
  }
}
