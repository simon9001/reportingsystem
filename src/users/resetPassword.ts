import { randomInt } from 'node:crypto'
import { passwordSchema } from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { hashPassword } from '../auth/password'
import { prisma } from '../lib/prisma'

// No look-alike characters (0/O, 1/l/I) so a password read off a screen can be typed back.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

export function generateTempPassword(length = 16): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

export interface ResetResult {
  email: string
  fullName: string
  role: string
  password: string
  generated: boolean
  reactivated: boolean
}

/**
 * Recovery path for a locked-out administrator (or any user): sets a temporary password, forces a change at the next
 * sign-in, reactivates the account, ends every session and writes an audit row. Throws without changing anything when
 * the email is unknown or the password is too short.
 */
export async function resetPasswordByEmail(rawEmail: string, password?: string): Promise<ResetResult> {
  const email = rawEmail.trim().toLowerCase()
  const chosen = password ?? generateTempPassword()
  const check = passwordSchema.safeParse(chosen)
  if (!check.success) throw new Error(check.error.issues[0]!.message)
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new Error(`No user with that email: ${email}`)
  const passwordHash = await hashPassword(chosen)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true, isActive: true } })
    await tx.session.deleteMany({ where: { userId: user.id } })
    await writeAudit(tx, { userId: null, entity: 'User', entityId: user.id, action: 'UPDATE', after: { passwordReset: true, via: 'command line' } })
  })
  return { email, fullName: user.fullName, role: user.role, password: chosen, generated: password === undefined, reactivated: !user.isActive }
}
