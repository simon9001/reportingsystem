import { z } from 'zod'
import { ROLES } from '../constants'
import { emailSchema, nameSchema, passwordSchema } from './common'

export const createUserSchema = z.object({
  fullName: nameSchema,
  email: emailSchema,
  role: z.enum(ROLES),
  password: passwordSchema,
})
export type CreateUserInput = z.input<typeof createUserSchema>

export const updateUserSchema = z
  .object({
    fullName: nameSchema.optional(),
    email: emailSchema.optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nothing to update')
export type UpdateUserInput = z.input<typeof updateUserSchema>

export const resetPasswordSchema = z.object({ password: passwordSchema })

export const listUsersQuerySchema = z.object({
  role: z.enum(ROLES).optional(),
  active: z.enum(['true', 'false']).optional(),
})
