import { config } from 'dotenv'

// SR_ENV_FILE lets scripts point at .env.test (e.g. the e2e server).
config({ path: process.env.SR_ENV_FILE ?? '.env', quiet: true })
