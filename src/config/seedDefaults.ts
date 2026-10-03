import { DEFAULT_SETTINGS, type LookupType, type Severity } from '@sr/shared'
import type { Db } from '../lib/prisma'

export const DEFAULT_SHIFT_DEFINITIONS = [
  { code: 'DAY', name: 'Day', startTime: '08:00', endTime: '17:00', sortOrder: 1 },
  { code: 'NIGHT', name: 'Night', startTime: '17:00', endTime: '08:00', sortOrder: 2 },
]

export const DEFAULT_ESCALATION_RULES: { severity: Severity; isRequired: boolean; notifyWho: string | null; withinMinutes: number | null }[] = [
  { severity: 'LOW', isRequired: false, notifyWho: null, withinMinutes: null },
  { severity: 'MEDIUM', isRequired: false, notifyWho: null, withinMinutes: null },
  { severity: 'HIGH', isRequired: true, notifyWho: 'ICT Officer', withinMinutes: 30 },
  { severity: 'CRITICAL', isRequired: true, notifyWho: 'ICT Officer and Manager', withinMinutes: 15 },
]

/** From the Lists sheet of the Excel prototype. */
export const DEFAULT_LOOKUPS: Partial<Record<LookupType, string[]>> = {
  CATEGORY: ['CCTV', 'Network', 'NVR/Server', 'Mobile Weighbridge', 'MettaX', 'Tracksolid', 'Security', 'Power/UPS', 'Equipment', 'Other'],
  SYSTEM: ['CCTV / Cameras', 'NVR / Frigate', 'Server', 'Network / Internet', 'MettaX', 'Tracksolid', 'UPS / Power', 'Control Room PCs / Displays'],
  TEAM: ['ICT', 'Control Room', 'Security', 'Maintenance', 'Management', 'Other'],
  PLATFORM: ['MettaX', 'Tracksolid', 'Other'],
}

/** Safe to run repeatedly: creates missing rows only, never overwrites. */
export async function seedDefaults(db: Db): Promise<void> {
  for (const d of DEFAULT_SHIFT_DEFINITIONS) {
    await db.shiftDefinition.upsert({ where: { code: d.code }, create: d, update: {} })
  }
  for (const r of DEFAULT_ESCALATION_RULES) {
    await db.escalationRule.upsert({ where: { severity: r.severity }, create: r, update: {} })
  }
  for (const [listType, values] of Object.entries(DEFAULT_LOOKUPS)) {
    for (const [i, value] of (values ?? []).entries()) {
      await db.lookupItem.upsert({ where: { listType_value: { listType, value } }, create: { listType, value, sortOrder: i + 1 }, update: {} })
    }
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.systemSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: {} })
  }
}
