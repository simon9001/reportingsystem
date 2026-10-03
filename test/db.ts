import { loginLimiter } from '../src/auth/rateLimit'
import { prisma } from '../src/lib/prisma'

/** Deletes every row. Refuses to touch anything but the test database. */
export async function resetDb(): Promise<void> {
  if (!process.env.SR_DATABASE_URL?.includes('database=shiftreporting_test')) {
    throw new Error('resetDb refused: SR_DATABASE_URL is not the shiftreporting_test database')
  }
  loginLimiter.clear()
  await prisma.auditLog.deleteMany()
  await prisma.session.deleteMany()
  await prisma.shift.deleteMany()
  await prisma.user.deleteMany()
  await prisma.vehicle.deleteMany()
  await prisma.lookupItem.deleteMany()
  await prisma.systemSetting.deleteMany()
  await prisma.escalationRule.deleteMany()
  await prisma.shiftDefinition.deleteMany()
}
