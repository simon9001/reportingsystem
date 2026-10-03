import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsUpdate } from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { prisma, type Db } from '../lib/prisma'
import type { SessionUser } from '../types'

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const rows = await db.systemSetting.findMany()
  const raw: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue
    try {
      raw[row.key] = JSON.parse(row.value)
    } catch {
      // keep the default for a corrupt value
    }
  }
  const parsed = settingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

export async function updateSettings(actor: SessionUser, input: SettingsUpdate, ip: string | null): Promise<Settings> {
  const before = await getSettings()
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue
      const json = JSON.stringify(value)
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
    }
    await writeAudit(tx, { userId: actor.id, entity: 'SystemSetting', action: 'UPDATE', before, after: { ...before, ...input }, ip })
  })
  return getSettings()
}
