import { PrismaMssql } from '@prisma/adapter-mssql'
import { PrismaClient, type Prisma } from '../generated/prisma/client'
import { env } from './env'

export const prisma = new PrismaClient({ adapter: new PrismaMssql(env.SR_DATABASE_URL) })

/** Either the client or an interactive-transaction client. */
export type Db = Prisma.TransactionClient
