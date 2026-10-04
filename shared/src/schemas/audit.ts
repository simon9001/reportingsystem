import { z } from 'zod'
import { dateStringSchema } from './common'

export const auditQuerySchema = z.object({
  entity: z.string().max(50).optional(),
  entityId: z.string().max(50).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
})
