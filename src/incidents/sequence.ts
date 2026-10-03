import { localDateString } from '@sr/shared'
import { env } from '../lib/env'
import type { Db } from '../lib/prisma'

export const formatIncidentRef = (year: number, n: number) => `INC-${year}-${String(n).padStart(4, '0')}`

/** Must run inside the create transaction. MERGE ... HOLDLOCK serialises concurrent writers per year. */
export async function nextIncidentRef(db: Db, occurredAt: Date): Promise<string> {
  const year = Number(localDateString(occurredAt, env.SR_APP_TIMEZONE).slice(0, 4))
  const rows = await db.$queryRaw<{ lastNumber: number }[]>`
    MERGE [dbo].[IncidentSequence] WITH (HOLDLOCK) AS t
    USING (SELECT ${year} AS [year]) AS s ON t.[year] = s.[year]
    WHEN MATCHED THEN UPDATE SET t.[lastNumber] = t.[lastNumber] + 1
    WHEN NOT MATCHED THEN INSERT ([year], [lastNumber]) VALUES (s.[year], 1)
    OUTPUT inserted.[lastNumber] AS lastNumber;`
  return formatIncidentRef(year, rows[0]!.lastNumber)
}
