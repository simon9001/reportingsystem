import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema, createUserSchema, dateStringSchema, hhmmSchema, loginSchema,
  rosterEntrySchema, rosterRangeQuerySchema, rosterUpsertSchema, settingsSchema, DEFAULT_SETTINGS,
} from '../src'

describe('shared schemas', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(dateStringSchema.safeParse('2026-09-30').success).toBe(true)
    expect(dateStringSchema.safeParse('2026-02-30').success).toBe(false)
    expect(dateStringSchema.safeParse('30/09/2026').success).toBe(false)
  })

  it('accepts 24-hour HH:mm only', () => {
    expect(hhmmSchema.safeParse('08:00').success).toBe(true)
    expect(hhmmSchema.safeParse('24:00').success).toBe(false)
    expect(hhmmSchema.safeParse('8:00').success).toBe(false)
  })

  it('normalises emails to trimmed lower case', () => {
    expect(loginSchema.parse({ email: '  Antony@KeNHA.go.ke ', password: 'x' }).email).toBe('antony@kenha.go.ke')
  })

  it('enforces the password policy on new users', () => {
    const r = createUserSchema.safeParse({ fullName: 'Antony Ochieng', email: 'a@b.co', role: 'OFFICER', password: 'short' })
    expect(r.success).toBe(false)
  })

  it('requires the new password to differ from the current one', () => {
    const r = changePasswordSchema.safeParse({ currentPassword: 'SamePassword1', newPassword: 'SamePassword1' })
    expect(r.success).toBe(false)
  })

  it('rejects a roster entry with the same person twice', () => {
    const r = rosterEntrySchema.safeParse({ shiftDate: '2026-09-30', shiftCode: 'DAY', supervisorId: 1, officerId: 1 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['officerId'])
  })

  it('rejects the same date and shift twice in one save', () => {
    const entry = { shiftDate: '2026-09-30', shiftCode: 'DAY', supervisorId: 1, officerId: 2 }
    expect(rosterUpsertSchema.safeParse({ entries: [entry, { ...entry, supervisorId: 3 }] }).success).toBe(false)
  })

  it('limits roster ranges to 92 days and correct order', () => {
    expect(rosterRangeQuerySchema.safeParse({ from: '2026-10-05', to: '2026-10-01' }).success).toBe(false)
    expect(rosterRangeQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(false)
    expect(rosterRangeQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-14' }).success).toBe(true)
  })

  it('has valid default settings', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
  })
})
