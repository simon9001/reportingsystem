import {
  addDays, daysBetween, fromDateString, toDateString,
  type CopyWeekResult, type CurrentShiftDto, type RosterEntryInput, type RosterPersonRef, type ShiftDto,
} from '@sr/shared'
import { writeAudit } from '../audit/audit'
import type { Prisma } from '../generated/prisma/client'
import { env } from '../lib/env'
import { AppError } from '../lib/errors'
import { prisma, type Db } from '../lib/prisma'
import { resolveShift, shiftWindow } from '../lib/shiftTime'
import type { SessionUser } from '../types'

const include = { definition: true, supervisor: true, officer: true } as const
export type ShiftWithPeople = Prisma.ShiftGetPayload<{ include: typeof include }>

function toRosterPerson(u: { id: number; fullName: string; isActive: boolean; role: string }): RosterPersonRef {
  return { id: u.id, fullName: u.fullName, rosterable: u.isActive && u.role === 'OFFICER' }
}

export function toShiftDto(s: ShiftWithPeople): ShiftDto {
  return {
    id: s.id,
    shiftDate: toDateString(s.shiftDate),
    shiftCode: s.definition.code,
    shiftName: s.definition.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    supervisor: toRosterPerson(s.supervisor),
    officer: toRosterPerson(s.officer),
  }
}

const orderBy = [{ shiftDate: 'asc' }, { startsAt: 'asc' }] as const

export async function listRoster(from: string, to: string): Promise<ShiftDto[]> {
  const rows = await prisma.shift.findMany({
    where: { shiftDate: { gte: fromDateString(from), lte: fromDateString(to) } },
    include,
    orderBy: [...orderBy],
  })
  return rows.map(toShiftDto)
}

async function assertRosterable(db: Db, ids: number[]): Promise<void> {
  const users = await db.user.findMany({ where: { id: { in: ids } } })
  for (const id of ids) {
    const u = users.find((x) => x.id === id)
    if (!u) throw new AppError('VALIDATION_ERROR', `User ${id} not found`, { entries: `User ${id} not found` })
    if (!u.isActive || u.role !== 'OFFICER') {
      const message = `${u.fullName} cannot be rostered (inactive or not a Control Room Officer)`
      throw new AppError('VALIDATION_ERROR', message, { entries: message })
    }
  }
}

function endedError(name: string, date: string) {
  return new AppError('CONFLICT', `The ${name} shift of ${date} has already ended. Only an administrator can change it.`)
}

export async function upsertRoster(actor: SessionUser, entries: RosterEntryInput[], ip: string | null, now = new Date()): Promise<ShiftDto[]> {
  const defs = await prisma.shiftDefinition.findMany({ where: { isActive: true } })
  for (const e of entries) {
    if (!defs.some((d) => d.code === e.shiftCode)) {
      throw new AppError('VALIDATION_ERROR', `Unknown shift "${e.shiftCode}"`, { entries: `Unknown shift "${e.shiftCode}"` })
    }
  }
  await assertRosterable(prisma, [...new Set(entries.flatMap((e) => [e.supervisorId, e.officerId]))])
  const isAdmin = actor.role === 'ADMIN'

  return prisma.$transaction(async (tx) => {
    const results: ShiftWithPeople[] = []
    for (const e of entries) {
      const def = defs.find((d) => d.code === e.shiftCode)!
      const shiftDate = fromDateString(e.shiftDate)
      const existing = await tx.shift.findUnique({
        where: { shiftDate_shiftDefinitionId: { shiftDate, shiftDefinitionId: def.id } },
        include,
      })
      if (existing) {
        if (existing.supervisorId === e.supervisorId && existing.officerId === e.officerId) {
          results.push(existing)
          continue
        }
        if (existing.endsAt <= now && !isAdmin) throw endedError(def.name, e.shiftDate)
        const updated = await tx.shift.update({
          where: { id: existing.id },
          data: { supervisorId: e.supervisorId, officerId: e.officerId },
          include,
        })
        await writeAudit(tx, { userId: actor.id, entity: 'Shift', entityId: updated.id, action: 'UPDATE', before: toShiftDto(existing), after: toShiftDto(updated), ip })
        results.push(updated)
      } else {
        const w = shiftWindow(e.shiftDate, def, env.SR_APP_TIMEZONE)
        if (w.endsAt <= now && !isAdmin) throw endedError(def.name, e.shiftDate)
        const created = await tx.shift.create({
          data: { shiftDate, shiftDefinitionId: def.id, startsAt: w.startsAt, endsAt: w.endsAt, supervisorId: e.supervisorId, officerId: e.officerId },
          include,
        })
        await writeAudit(tx, { userId: actor.id, entity: 'Shift', entityId: created.id, action: 'CREATE', after: toShiftDto(created), ip })
        results.push(created)
      }
    }
    return results.map(toShiftDto)
  })
}

export async function deleteRosterShift(actor: SessionUser, id: number, ip: string | null, now = new Date()): Promise<void> {
  const shift = await prisma.shift.findUnique({ where: { id }, include })
  if (!shift) throw new AppError('NOT_FOUND', 'Shift not found')
  if (shift.startsAt <= now) throw new AppError('CONFLICT', 'A shift that has already started cannot be removed')
  await prisma.$transaction(async (tx) => {
    await tx.shift.delete({ where: { id } })
    await writeAudit(tx, { userId: actor.id, entity: 'Shift', entityId: id, action: 'DELETE', before: toShiftDto(shift), ip })
  })
}

export async function copyWeek(
  actor: SessionUser,
  input: { fromWeekStart: string; toWeekStart: string; swapRoles: boolean },
  ip: string | null,
  now = new Date(),
): Promise<CopyWeekResult> {
  const source = await prisma.shift.findMany({
    where: { shiftDate: { gte: fromDateString(input.fromWeekStart), lte: fromDateString(addDays(input.fromWeekStart, 6)) } },
    include,
    orderBy: [...orderBy],
  })
  let created = 0
  let skipped = 0
  await prisma.$transaction(async (tx) => {
    for (const s of source) {
      const targetDate = addDays(input.toWeekStart, daysBetween(input.fromWeekStart, toDateString(s.shiftDate)))
      const supervisorId = input.swapRoles ? s.officerId : s.supervisorId
      const officerId = input.swapRoles ? s.supervisorId : s.officerId
      const exists = await tx.shift.findUnique({
        where: { shiftDate_shiftDefinitionId: { shiftDate: fromDateString(targetDate), shiftDefinitionId: s.shiftDefinitionId } },
      })
      const peopleOk = [s.supervisor, s.officer].every((u) => u.isActive && u.role === 'OFFICER')
      const w = shiftWindow(targetDate, s.definition, env.SR_APP_TIMEZONE)
      if (exists || !peopleOk || !s.definition.isActive || (w.endsAt <= now && actor.role !== 'ADMIN')) {
        skipped += 1
        continue
      }
      const row = await tx.shift.create({
        data: { shiftDate: fromDateString(targetDate), shiftDefinitionId: s.shiftDefinitionId, startsAt: w.startsAt, endsAt: w.endsAt, supervisorId, officerId },
        include,
      })
      await writeAudit(tx, { userId: actor.id, entity: 'Shift', entityId: row.id, action: 'CREATE', after: toShiftDto(row), ip })
      created += 1
    }
  })
  return { created, skipped }
}

/** The stored shift whose window contains `instant`, if any (windows are frozen when the shift is created). */
export async function findShiftAt(instant: Date, db: Db = prisma): Promise<ShiftWithPeople | null> {
  return db.shift.findFirst({
    where: { startsAt: { lte: instant }, endsAt: { gt: instant } },
    include,
    orderBy: { startsAt: 'desc' },
  })
}

/** The shift happening at `now`, whether or not anyone is rostered, and the user's role on it. */
export async function getCurrentShift(userId: number | null, now = new Date()): Promise<CurrentShiftDto | null> {
  const row = await findShiftAt(now)
  if (row) {
    const rosterable = (u: { isActive: boolean; role: string }) => u.isActive && u.role === 'OFFICER'
    const myRole =
      userId === null ? null
        : row.supervisor.id === userId && rosterable(row.supervisor) ? 'SUPERVISOR'
        : row.officer.id === userId && rosterable(row.officer) ? 'OFFICER'
        : null
    return {
      shiftDate: toDateString(row.shiftDate),
      shiftCode: row.definition.code,
      shiftName: row.definition.name,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      shift: toShiftDto(row),
      myRole,
    }
  }
  const defs = await prisma.shiftDefinition.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
  const resolved = resolveShift(now, defs, env.SR_APP_TIMEZONE)
  if (!resolved) return null
  return {
    shiftDate: resolved.shiftDate,
    shiftCode: resolved.definition.code,
    shiftName: resolved.definition.name,
    startsAt: resolved.startsAt.toISOString(),
    endsAt: resolved.endsAt.toISOString(),
    shift: null,
    myRole: null,
  }
}
