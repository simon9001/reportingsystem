import { PrismaMssql } from '@prisma/adapter-mssql'
import { PrismaClient, type Prisma } from '../generated/prisma/client'
import { mssqlConfig } from './dbConfig'
import { db } from './env'

// Prisma's defaults (2s to start, 5s to finish) turn a brief database or server pause into a failed request.
export const prisma = new PrismaClient({ adapter: new PrismaMssql(mssqlConfig(db)), transactionOptions: { maxWait: 10_000, timeout: 30_000 } })

/** Either the client or an interactive-transaction client. */
export type Db = Prisma.TransactionClient
