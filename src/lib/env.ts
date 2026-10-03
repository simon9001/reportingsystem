import { DEFAULT_TIMEZONE } from '@sr/shared'
import { z } from 'zod'
import { readDbSettings } from './dbConfig'

const envSchema = z.object({
  SR_PORT: z.coerce.number().int().positive().default(3000),
  SR_UPLOAD_DIR: z.string().min(1).default('uploads'),
  SR_APP_BASE_URL: z.url().default('http://localhost:5173'),
  SR_APP_TIMEZONE: z.string().default(DEFAULT_TIMEZONE).refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v })
      return true
    } catch {
      return false
    }
  }, 'SR_APP_TIMEZONE must be a valid IANA time zone'),
  SR_COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SR_TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SR_SESSION_HOURS: z.coerce.number().positive().default(12),
  SR_SEED_ADMIN_EMAIL: z.string().optional(),
  SR_SEED_ADMIN_NAME: z.string().default('System Administrator'),
  SR_SEED_ADMIN_PASSWORD: z.string().min(10, 'SR_SEED_ADMIN_PASSWORD must be at least 10 characters').optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error))
  throw new Error('Invalid environment configuration')
}

export const env = parsed.data
export const db = readDbSettings()
