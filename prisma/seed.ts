import '../src/loadEnv'
import { hashPassword } from '../src/auth/password'
import { seedDefaults } from '../src/config/seedDefaults'
import { env } from '../src/lib/env'
import { prisma } from '../src/lib/prisma'

await seedDefaults(prisma)

const admins = await prisma.user.count({ where: { role: 'ADMIN' } })
if (admins === 0) {
  if (!env.SR_SEED_ADMIN_EMAIL || !env.SR_SEED_ADMIN_PASSWORD) {
    throw new Error('Set SR_SEED_ADMIN_EMAIL and SR_SEED_ADMIN_PASSWORD in .env to create the first administrator')
  }
  await prisma.user.create({
    data: {
      fullName: env.SR_SEED_ADMIN_NAME,
      email: env.SR_SEED_ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: await hashPassword(env.SR_SEED_ADMIN_PASSWORD),
      role: 'ADMIN',
      mustChangePassword: true,
    },
  })
  console.log(`Created administrator ${env.SR_SEED_ADMIN_EMAIL} - they must change the password at first sign-in.`)
}

console.log('Seed complete.')
await prisma.$disconnect()
