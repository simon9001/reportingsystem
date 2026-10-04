import { z } from 'zod'
import { emailSchema, passwordSchema } from './common'

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
})
export type LoginInput = z.input<typeof loginSchema>

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword: passwordSchema })
  .refine((d) => d.currentPassword !== d.newPassword, { path: ['newPassword'], message: 'New password must be different' })
export type ChangePasswordInput = z.input<typeof changePasswordSchema>
