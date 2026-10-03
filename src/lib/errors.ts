import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ErrorCode =
  | 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'RATE_LIMITED' | 'NO_ROSTER' | 'INTERNAL'

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NO_ROSTER: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly fields?: Record<string, string>

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.fields = fields
  }
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'P2002'
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } }, STATUS[err.code])
  }
  if (isUniqueViolation(err)) {
    return c.json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } }, 409)
  }
  const requestId: string | undefined = c.get('requestId')
  console.error(`[request ${requestId ?? '-'}]`, err)
  return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId } }, 500)
}
