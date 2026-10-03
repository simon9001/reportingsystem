import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsUpdate } from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { publish } from '../events/bus'
import { prisma, type Db } from '../lib/prisma'
import type { SessionUser } from '../types'

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const rows = await db.systemSetting.findMany()
  const stored = new Map(rows.map((r) => [r.key, r.value]))
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const text = stored.get(key)
    if (text === undefined) continue
    try {
      const parsed = settingsSchema.shape[key].safeParse(JSON.parse(text))
      if (parsed.success) {
        result[key] = parsed.data
        continue
      }
    } catch {
      // fall through to the warning
    }
    console.warn(`Setting "${key}" has an invalid stored value; using the default`)
  }
  return result as Settings
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
  publish('config', 'audit')
  return getSettings()
}
