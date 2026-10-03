import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

config({ path: process.env.SR_ENV_FILE ?? '.env', quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.SR_DATABASE_URL },
})
