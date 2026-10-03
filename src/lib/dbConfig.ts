import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const dbSchema = z.object({
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_SERVER: z.string().min(1, 'DB_SERVER is required'),
  DB_DATABASE: z.string().min(1, 'DB_DATABASE is required'),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_ENCRYPT: bool.default(false),
  DB_TRUST_SERVER_CERTIFICATE: bool.default(true),
})

export type DbSettings = z.output<typeof dbSchema>

/** Reads the DB_* variables. Kept free of other env validation so prisma.config.ts can use it too. */
export function readDbSettings(source: NodeJS.ProcessEnv = process.env): DbSettings {
  const parsed = dbSchema.safeParse(source)
  if (!parsed.success) {
    throw new Error('Invalid database configuration:\n' + z.prettifyError(parsed.error))
  }
  return parsed.data
}

/** Braces let the password contain ; @ % etc. (verified with Prisma 7.10); a literal } is doubled. */
const quote = (v: string) => '{' + v.replaceAll('}', '}}') + '}'

/** Connection string for the Prisma CLI (migrate, generate). */
export function dbUrl(s: DbSettings): string {
  return [
    `sqlserver://${s.DB_SERVER}:${s.DB_PORT}`,
    `database=${s.DB_DATABASE}`,
    `user=${s.DB_USER}`,
    `password=${quote(s.DB_PASSWORD)}`,
    `encrypt=${s.DB_ENCRYPT}`,
    `trustServerCertificate=${s.DB_TRUST_SERVER_CERTIFICATE}`,
  ].join(';')
}

/** Config object for the mssql driver used by @prisma/adapter-mssql (no string escaping involved). */
export function mssqlConfig(s: DbSettings) {
  return {
    server: s.DB_SERVER,
    port: s.DB_PORT,
    database: s.DB_DATABASE,
    user: s.DB_USER,
    password: s.DB_PASSWORD,
    options: { encrypt: s.DB_ENCRYPT, trustServerCertificate: s.DB_TRUST_SERVER_CERTIFICATE },
  }
}
