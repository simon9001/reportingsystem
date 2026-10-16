// Usage: pnpm admin:reset-password <email> [--password <temporary password>]
// Works on whichever database Backend/.env (or SR_ENV_FILE) points at.
import '../src/loadEnv'
import { prisma } from '../src/lib/prisma'
import { resetPasswordByEmail } from '../src/users/resetPassword'

const args = process.argv.slice(2)
const flag = args.indexOf('--password')
const password = flag >= 0 ? args[flag + 1] : undefined
const email = args.find((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1))

if (!email || (flag >= 0 && (!password || password.startsWith('--')))) {
  console.error('Usage: pnpm admin:reset-password <email> [--password <temporary password>]')
  process.exit(1)
}

try {
  const r = await resetPasswordByEmail(email, password)
  console.log(`Password reset for ${r.fullName} <${r.email}> (${r.role}).`)
  if (r.reactivated) console.log('The account was inactive and has been reactivated.')
  console.log(`Temporary password: ${r.password}`)
  console.log('They must choose a new password at their next sign-in. All their sessions were signed out.')
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
