import { PrismaMssql } from '@prisma/adapter-mssql'
import { PrismaClient, type Prisma } from '../generated/prisma/client'
import { mssqlConfig } from './dbConfig'
import { db } from './env'

export const prisma = new PrismaClient({ adapter: new PrismaMssql(mssqlConfig(db)) })

/** Either the client or an interactive-transaction client. */
export type Db = Prisma.TransactionClient
