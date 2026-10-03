import type { SessionUserDto } from '@sr/shared'
import type { RequestIdVariables } from 'hono/request-id'

export type SessionUser = SessionUserDto

export type AppEnv = {
  Variables: RequestIdVariables & { user: SessionUser | null; sessionId: string | null }
}
