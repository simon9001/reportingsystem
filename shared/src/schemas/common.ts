import { z } from 'zod'

export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'This date does not exist')

export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 08:00')
export const idSchema = z.coerce.number().int().positive().max(2147483647)
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200, 'Password is too long')
export const nameSchema = z.string().trim().min(2, 'Enter at least 2 characters').max(120, 'Too long')
