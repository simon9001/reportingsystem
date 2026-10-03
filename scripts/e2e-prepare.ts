import '../src/loadEnv'
import { hashPassword } from '../src/auth/password'
import { seedDefaults } from '../src/config/seedDefaults'
import { prisma } from '../src/lib/prisma'
import { resetDb } from '../test/db'

await resetDb() // refuses to run unless SR_DATABASE_URL is the shiftreporting_test database
await seedDefaults(prisma)
await prisma.user.create({
  data: {
    fullName: 'E2E Administrator',
    email: 'e2e-admin@test.local',
    passwordHash: await hashPassword('AdminTemp2026'),
    role: 'ADMIN',
    mustChangePassword: true,
  },
})
console.log('E2E database ready.')
await prisma.$disconnect()
