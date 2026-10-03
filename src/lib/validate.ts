import { idSchema } from '@sr/shared'
import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from './errors'

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_'
    out[key] ??= issue.message
  }
  return out
}

function check<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const r = schema.safeParse(raw)
  if (!r.success) throw new AppError('VALIDATION_ERROR', 'Some fields are invalid', fieldErrors(r.error))
  return r.data
}

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The request body must be valid JSON')
  }
  return check(schema, raw)
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  return check(schema, c.req.query())
}

export function parseId(c: Context, name = 'id'): number {
  const r = idSchema.safeParse(c.req.param(name))
  if (!r.success) throw new AppError('NOT_FOUND', 'Not found')
  return r.data
}
