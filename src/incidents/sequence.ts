import { INCIDENT_REF_PREFIX, localDateString, type IncidentSide } from '@sr/shared'
import { env } from '../lib/env'
import type { Db } from '../lib/prisma'

export const formatIncidentRef = (prefix: string, year: number, n: number) => `${prefix}-${year}-${String(n).padStart(4, '0')}`

/** Must run inside the create transaction. MERGE ... HOLDLOCK serialises concurrent writers per prefix and year. */
export async function nextIncidentRef(db: Db, occurredAt: Date, side: IncidentSide = 'STATIC'): Promise<string> {
  const prefix = INCIDENT_REF_PREFIX[side]
  const year = Number(localDateString(occurredAt, env.SR_APP_TIMEZONE).slice(0, 4))
  const rows = await db.$queryRaw<{ lastNumber: number }[]>`
    MERGE [dbo].[IncidentSequence] WITH (HOLDLOCK) AS t
    USING (SELECT ${prefix} AS [prefix], ${year} AS [year]) AS s ON t.[prefix] = s.[prefix] AND t.[year] = s.[year]
    WHEN MATCHED THEN UPDATE SET t.[lastNumber] = t.[lastNumber] + 1
    WHEN NOT MATCHED THEN INSERT ([prefix], [year], [lastNumber]) VALUES (s.[prefix], s.[year], 1)
    OUTPUT inserted.[lastNumber] AS lastNumber;`
  return formatIncidentRef(prefix, year, rows[0]!.lastNumber)
}
