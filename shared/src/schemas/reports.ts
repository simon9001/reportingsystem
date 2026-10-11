import { z } from 'zod'
import { EMAIL_JOB_STATUSES, OVERALL_STATUSES, REPORT_TEXT_MAX, REPORT_TIMELINESS } from '../constants'
import { dateStringSchema } from './common'

const text = z.string().trim().max(REPORT_TEXT_MAX, `Keep this under ${REPORT_TEXT_MAX} characters`).nullable()
  .transform((v) => (v ? v : null))

/** Partial draft save; updatedAt is the version the client last saw (optimistic concurrency). */
export const reportUpdateSchema = z.object({
  overallStatus: z.enum(OVERALL_STATUSES).nullable().optional(),
  overview: text.optional(),
  keyEvents: text.optional(),
  pendingActions: text.optional(),
  operationalConcerns: text.optional(),
  recommendations: text.optional(),
  confirmReviewed: z.boolean().optional(),
  confirmEscalated: z.boolean().optional(),
  confirmHandedOver: z.boolean().optional(),
  confirmSubmitted: z.boolean().optional(),
  updatedAt: z.iso.datetime(),
})
export type ReportUpdateInput = z.input<typeof reportUpdateSchema>
export type ReportUpdateParsed = z.output<typeof reportUpdateSchema>

export const reportQuerySchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  shiftCode: z.string().max(20).optional(),
  status: z.enum(['DRAFT', 'SUBMITTED', 'OVERDUE']).optional(),
  timeliness: z.enum(REPORT_TIMELINESS).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})
export type ReportQuery = z.output<typeof reportQuerySchema>

export const emailJobQuerySchema = z.object({
  status: z.enum(EMAIL_JOB_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
})
