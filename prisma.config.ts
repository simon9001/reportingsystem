import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'
import { dbUrl, readDbSettings } from './src/lib/dbConfig'

config({ path: process.env.SR_ENV_FILE ?? '.env', quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: dbUrl(readDbSettings()) },
})
