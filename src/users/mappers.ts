import type { Role, SessionUserDto, UserDto } from '@sr/shared'
import type { User } from '../generated/prisma/client'

export function toSessionUser(u: User): SessionUserDto {
  return { id: u.id, fullName: u.fullName, email: u.email, role: u.role as Role, mustChangePassword: u.mustChangePassword }
}

export function toUserDto(u: User): UserDto {
  return {
    ...toSessionUser(u),
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }
}
