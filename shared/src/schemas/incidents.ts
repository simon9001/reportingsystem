import { z } from 'zod'
import { INCIDENT_STATUSES, LINK_STATUSES, RESOLVED_STATUSES, SEVERITIES, VEHICLE_STATUSES, type IncidentStatus } from '../constants'
import { daysBetween } from '../dates'
import { dateStringSchema, idSchema } from './common'

const instant = z.iso.datetime({ offset: true, error: 'Enter a valid date and time' })
const optionalText = (max: number) =>
  z.string().trim().max(max, `At most ${max} characters`).nullable().optional().transform((v) => (v ? v : null))
const optionalInstant = instant.nullable().optional().transform((v) => v ?? null)

const onlyMobile = z.null({ error: 'Only for mobile weighbridge incidents' }).optional()
const onlyStatic = z.null({ error: 'Only for static weighbridge incidents' }).optional()
const optionalId = z.number().int().positive().max(2147483647).nullable().optional().transform((v) => v ?? null)

const commonFields = {
  occurredAt: instant,
  categoryId: z.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  severity: z.enum(SEVERITIES, { error: 'Choose a severity' }),
  description: z.string().trim().min(3, 'Describe what happened').max(2000, 'At most 2000 characters'),
  immediateAction: optionalText(2000),
  escalatedTo: optionalText(200),
  escalatedAt: optionalInstant,
  assignedTo: optionalText(200),
  status: z.enum(INCIDENT_STATUSES, { error: 'Choose a status' }),
  resolvedAt: optionalInstant,
  resolution: optionalText(2000),
}

/** Incident Register sheet: fixed weighbridge stations. */
const staticIncidentSchema = z.object({
  side: z.literal('STATIC'),
  ...commonFields,
  locationId: z.number({ error: 'Choose a location' }).int().positive('Choose a location'),
  locationDetail: optionalText(200),
  locationText: onlyMobile,
  vehicleId: onlyMobile,
  vehicleStatus: onlyMobile,
  gpsStatus: onlyMobile,
  dashcamStatus: onlyMobile,
  platformId: onlyMobile,
  remarks: onlyMobile,
})

/** Mobile Weighbridge sheet: vehicle units, tracked to resolution like static incidents. */
const mobileIncidentSchema = z.object({
  side: z.literal('MOBILE'),
  ...commonFields,
  description: z.string().trim().min(3, 'Describe the event / incident').max(2000, 'At most 2000 characters'),
  vehicleId: z.number({ error: 'Choose the vehicle / unit' }).int().positive('Choose the vehicle / unit'),
  locationId: optionalId,
  locationText: optionalText(100),
  vehicleStatus: z.enum(VEHICLE_STATUSES, { error: 'Choose the vehicle status' }),
  gpsStatus: z.enum(LINK_STATUSES, { error: 'Choose the GPS status' }),
  dashcamStatus: z.enum(LINK_STATUSES, { error: 'Choose the dashcam status' }),
  platformId: z.number({ error: 'Choose the platform' }).int().positive('Choose the platform'),
  remarks: optionalText(2000),
  locationDetail: onlyStatic,
})

const incidentUnionSchema = z.discriminatedUnion('side', [staticIncidentSchema, mobileIncidentSchema], { error: 'Choose static or mobile weighbridge' })

/** Input without a side is a static incident (the original register). */
const defaultSide = (v: unknown) =>
  v !== null && typeof v === 'object' && (v as { side?: unknown }).side === undefined ? { ...(v as object), side: 'STATIC' } : v

export const incidentInputSchema = z.preprocess(defaultSide, incidentUnionSchema).superRefine((d, ctx) => {
  const occurred = Date.parse(d.occurredAt)
  if ((RESOLVED_STATUSES as readonly IncidentStatus[]).includes(d.status) && !d.resolvedAt) {
    ctx.addIssue({ code: 'custom', path: ['resolvedAt'], message: 'Enter when it was resolved' })
  }
  if (d.resolvedAt && Date.parse(d.resolvedAt) < occurred) {
    ctx.addIssue({ code: 'custom', path: ['resolvedAt'], message: 'Cannot be before the incident time' })
  }
  if (d.escalatedAt && Date.parse(d.escalatedAt) < occurred) {
    ctx.addIssue({ code: 'custom', path: ['escalatedAt'], message: 'Cannot be before the incident time' })
  }
  if (d.escalatedAt && !d.escalatedTo) {
    ctx.addIssue({ code: 'custom', path: ['escalatedTo'], message: 'Say who was notified' })
  }
  if (d.side === 'MOBILE' && !d.locationId === !d.locationText) {
    ctx.addIssue({ code: 'custom', path: ['locationText'], message: d.locationId ? 'Pick a listed place or type one, not both' : 'Enter where the unit is' })
  }
})
export type IncidentInput = z.input<typeof incidentUnionSchema>
export type IncidentInputParsed = z.output<typeof incidentUnionSchema>

/** Comma-separated query value → array (`severity=HIGH,CRITICAL`). */
const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : String(v).split(',').filter(Boolean)), z.array(item).optional())

/** Far beyond any real result set; keeps OFFSET arithmetic within safe integers. */
export const MAX_PAGE = 100_000

export const INCIDENT_SORTS = ['occurredAt', '-occurredAt', 'severity', '-severity', 'status', '-status', 'ref', '-ref'] as const

export const incidentQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
    severity: csv(z.enum(SEVERITIES)),
    status: csv(z.enum(INCIDENT_STATUSES)),
    categoryId: csv(idSchema),
    locationId: csv(idSchema),
    shiftCode: z.string().trim().max(20).optional(),
    shiftId: idSchema.optional(),
    hasAttachments: z.enum(['true', 'false']).optional(),
    reportedById: idSchema.optional(),
    sort: z.enum(INCIDENT_SORTS).default('-occurredAt'),
    page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
    pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), 'Page size must be 25, 50 or 100').default(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: '"to" must be on or after "from"' })
export type IncidentQuery = z.output<typeof incidentQuerySchema>

export const analyticsQuerySchema = z
  .object({ from: dateStringSchema, to: dateStringSchema })
  .refine((q) => q.from <= q.to, { path: ['to'], message: '"to" must be on or after "from"' })
  .refine((q) => daysBetween(q.from, q.to) <= 366, { path: ['to'], message: 'The period can be at most one year' })
