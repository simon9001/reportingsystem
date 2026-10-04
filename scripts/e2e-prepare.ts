import '../src/loadEnv'
import { fromDateString } from '@sr/shared'
import { hashPassword } from '../src/auth/password'
import { seedDefaults } from '../src/config/seedDefaults'
import { env } from '../src/lib/env'
import { prisma } from '../src/lib/prisma'
import { resolveShift, shiftWindow } from '../src/lib/shiftTime'
import { resetDb } from '../test/db'

await resetDb() // refuses to run unless DB_DATABASE is the shiftreporting_test database
await seedDefaults(prisma)

const user = async (email: string, fullName: string, role: string, password: string, mustChangePassword = false) =>
  prisma.user.create({ data: { email, fullName, role, passwordHash: await hashPassword(password), mustChangePassword } })

await user('e2e-admin@test.local', 'E2E Administrator', 'ADMIN', 'AdminTemp2026', true)
await user('e2e-dd@test.local', 'Grace Wanjiru', 'DEPUTY_DIRECTOR', 'DirectorPass2026')
const sup = await user('e2e-sup@test.local', 'Brian Otieno', 'OFFICER', 'SupervisorPass2026')
const off = await user('e2e-off@test.local', 'Mary Wambui', 'OFFICER', 'OfficerPass2026')

const defs = await prisma.shiftDefinition.findMany({ where: { isActive: true } })
const now = resolveShift(new Date(), defs, env.SR_APP_TIMEZONE)
if (!now) throw new Error('E2E prepare: no active shift definition covers the current time; cannot roster the current shift.')
const w = shiftWindow(now.shiftDate, now.definition, env.SR_APP_TIMEZONE)
await prisma.shift.create({
  data: { shiftDate: fromDateString(now.shiftDate), shiftDefinitionId: now.definition.id, startsAt: w.startsAt, endsAt: w.endsAt, supervisorId: sup.id, officerId: off.id },
})
console.log('E2E database ready.')
await prisma.$disconnect()
