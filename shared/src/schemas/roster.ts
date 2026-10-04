import { z } from 'zod'
import { daysBetween } from '../dates'
import { dateStringSchema } from './common'

export const rosterEntrySchema = z
  .object({
    shiftDate: dateStringSchema,
    shiftCode: z.string().trim().min(1).max(20),
    supervisorId: z.number().int().positive('Choose the Shift Supervisor'),
    officerId: z.number().int().positive('Choose the Control Room Officer'),
  })
  .refine((e) => e.supervisorId !== e.officerId, { path: ['officerId'], message: 'Supervisor and Officer must be different people' })
export type RosterEntryInput = z.input<typeof rosterEntrySchema>

export const rosterUpsertSchema = z
  .object({ entries: z.array(rosterEntrySchema).min(1, 'Nothing to save').max(200) })
  .refine((d) => new Set(d.entries.map((e) => `${e.shiftDate}|${e.shiftCode}`)).size === d.entries.length, {
    path: ['entries'],
    message: 'The same shift appears more than once',
  })

export const rosterRangeQuerySchema = z
  .object({ from: dateStringSchema, to: dateStringSchema })
  .refine((q) => q.from <= q.to, { path: ['to'], message: '"to" must be on or after "from"' })
  .refine((q) => daysBetween(q.from, q.to) <= 92, { path: ['to'], message: 'The range can be at most 92 days' })

export const copyWeekSchema = z
  .object({ fromWeekStart: dateStringSchema, toWeekStart: dateStringSchema, swapRoles: z.boolean().default(false) })
  .refine((d) => d.fromWeekStart !== d.toWeekStart, { path: ['toWeekStart'], message: 'Choose a different week' })
export type CopyWeekInput = z.input<typeof copyWeekSchema>
