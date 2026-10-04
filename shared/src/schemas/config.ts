import { z } from 'zod'
import { LOOKUP_TYPES, SEVERITIES } from '../constants'
import { emailSchema, hhmmSchema, idSchema } from './common'

export const shiftDefinitionUpdateSchema = z
  .object({ id: idSchema, name: z.string().trim().min(1, 'Enter a name').max(50), startTime: hhmmSchema, endTime: hhmmSchema })
  .refine((d) => d.startTime !== d.endTime, { path: ['endTime'], message: 'End time must differ from start time' })
export const shiftDefinitionsUpdateSchema = z.array(shiftDefinitionUpdateSchema).min(1)
export type ShiftDefinitionUpdate = z.input<typeof shiftDefinitionUpdateSchema>

export const escalationRuleSchema = z.object({
  severity: z.enum(SEVERITIES),
  isRequired: z.boolean(),
  notifyWho: z.string().trim().max(200).nullable(),
  withinMinutes: z.number().int().min(1, 'At least 1 minute').max(1440).nullable(),
})
export type EscalationRuleInput = z.input<typeof escalationRuleSchema>
export const escalationRulesUpdateSchema = z
  .array(escalationRuleSchema)
  .length(SEVERITIES.length)
  .refine((rules) => new Set(rules.map((r) => r.severity)).size === SEVERITIES.length, 'Provide one rule for each severity')

export const settingsSchema = z.object({
  reportDeadlineMinutes: z.number().int().min(0).max(720),
  ddEmails: z.array(emailSchema).max(10),
  alertSeverities: z.array(z.enum(SEVERITIES)),
  recurringCount: z.number().int().min(2).max(50),
  recurringDays: z.number().int().min(1).max(90),
  longOpenShifts: z.number().int().min(1).max(60),
})
export type Settings = z.output<typeof settingsSchema>
export const settingsUpdateSchema = settingsSchema.partial()
export type SettingsUpdate = z.input<typeof settingsUpdateSchema>
export const DEFAULT_SETTINGS: Settings = {
  reportDeadlineMinutes: 30,
  ddEmails: [],
  alertSeverities: ['HIGH', 'CRITICAL'],
  recurringCount: 3,
  recurringDays: 7,
  longOpenShifts: 4,
}

const lookupValue = z.string().trim().min(1, 'Enter a value').max(100)
const sortOrder = z.number().int().min(0).max(9999)
export const createLookupSchema = z.object({ listType: z.enum(LOOKUP_TYPES), value: lookupValue, sortOrder: sortOrder.optional() })
export type CreateLookupInput = z.input<typeof createLookupSchema>
export const updateLookupSchema = z.object({ value: lookupValue.optional(), sortOrder: sortOrder.optional(), isActive: z.boolean().optional() })
export type UpdateLookupInput = z.input<typeof updateLookupSchema>
export const listLookupsQuerySchema = z.object({ listType: z.enum(LOOKUP_TYPES).optional(), active: z.enum(['true', 'false']).optional() })

const unitId = z.string().trim().toUpperCase().min(1, 'Enter the vehicle / unit ID').max(50)
const description = z.string().trim().max(200).nullable()
export const createVehicleSchema = z.object({ unitId, description: description.optional() })
export type CreateVehicleInput = z.input<typeof createVehicleSchema>
export const updateVehicleSchema = z.object({ unitId: unitId.optional(), description: description.optional(), isActive: z.boolean().optional() })
export type UpdateVehicleInput = z.input<typeof updateVehicleSchema>
export const listVehiclesQuerySchema = z.object({ active: z.enum(['true', 'false']).optional() })
