import type { createUserSchema, Role, updateUserSchema, UserDto } from '@sr/shared'
import type { z } from 'zod'
import { writeAudit } from '../audit/audit'
import { hashPassword } from '../auth/password'
import { AppError, isUniqueViolation } from '../lib/errors'
import { prisma } from '../lib/prisma'
import type { SessionUser } from '../types'
import { toUserDto } from './mappers'

const emailTaken = () => new AppError('CONFLICT', 'A user with this email already exists', { email: 'This email is already in use' })

export async function listUsers(q: { role?: Role; active?: 'true' | 'false' }): Promise<UserDto[]> {
  const users = await prisma.user.findMany({
    where: { role: q.role, isActive: q.active === undefined ? undefined : q.active === 'true' },
    orderBy: { fullName: 'asc' },
  })
  return users.map(toUserDto)
}

export async function createUser(actor: SessionUser, input: z.output<typeof createUserSchema>, ip: string | null): Promise<UserDto> {
  const passwordHash = await hashPassword(input.password)
  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { fullName: input.fullName, email: input.email, role: input.role, passwordHash, mustChangePassword: true },
      })
      await writeAudit(tx, { userId: actor.id, entity: 'User', entityId: u.id, action: 'CREATE', after: toUserDto(u), ip })
      return u
    })
    return toUserDto(user)
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTaken()
    throw err
  }
}

export async function updateUser(actor: SessionUser, id: number, input: z.output<typeof updateUserSchema>, ip: string | null): Promise<UserDto> {
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) throw new AppError('NOT_FOUND', 'User not found')
  if (id === actor.id && (input.isActive === false || (input.role !== undefined && input.role !== existing.role))) {
    throw new AppError('CONFLICT', 'You cannot deactivate yourself or change your own role')
  }
  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: input })
      if (input.isActive === false) await tx.session.deleteMany({ where: { userId: id } })
      await writeAudit(tx, { userId: actor.id, entity: 'User', entityId: id, action: 'UPDATE', before: toUserDto(existing), after: toUserDto(u), ip })
      return u
    })
    return toUserDto(user)
  } catch (err) {
    if (isUniqueViolation(err)) throw emailTaken()
    throw err
  }
}

export async function resetUserPassword(actor: SessionUser, id: number, password: string, ip: string | null): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) throw new AppError('NOT_FOUND', 'User not found')
  const passwordHash = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } })
    await tx.session.deleteMany({ where: { userId: id } })
    await writeAudit(tx, { userId: actor.id, entity: 'User', entityId: id, action: 'UPDATE', after: { passwordReset: true }, ip })
  })
}
