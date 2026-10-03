import {
  SEVERITIES,
  type CreateLookupInput, type CreateVehicleInput, type EscalationRuleDto, type EscalationRuleInput, type LookupItemDto,
  type LookupType, type Severity, type ShiftDefinitionDto, type ShiftDefinitionUpdate, type UpdateLookupInput,
  type UpdateVehicleInput, type VehicleDto,
} from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { publish } from '../events/bus'
import { AppError, isUniqueViolation } from '../lib/errors'
import { prisma, type Db } from '../lib/prisma'
import { coverageProblem } from '../lib/shiftTime'
import type { SessionUser } from '../types'
import { toEscalationRuleDto, toLookupDto, toShiftDefinitionDto, toVehicleDto } from './mappers'

const activeFilter = (active?: 'true' | 'false') => (active === undefined ? undefined : active === 'true')

// ---- Shift definitions ----

export async function listShiftDefinitions(db: Db = prisma): Promise<ShiftDefinitionDto[]> {
  return (await db.shiftDefinition.findMany({ orderBy: { sortOrder: 'asc' } })).map(toShiftDefinitionDto)
}

/** Existing roster rows keep their stored start/end; only shifts created later use the new times. */
export async function updateShiftDefinitions(actor: SessionUser, updates: ShiftDefinitionUpdate[], ip: string | null) {
  const existing = await prisma.shiftDefinition.findMany({ orderBy: { sortOrder: 'asc' } })
  for (const u of updates) {
    if (!existing.some((d) => d.id === Number(u.id))) throw new AppError('NOT_FOUND', `Shift definition ${u.id} not found`)
  }
  const merged = existing.map((d) => {
    const u = updates.find((x) => Number(x.id) === d.id)
    return u ? { ...d, name: u.name, startTime: u.startTime, endTime: u.endTime } : d
  })
  const problem = coverageProblem(merged.filter((d) => d.isActive))
  if (problem) throw new AppError('VALIDATION_ERROR', `Shift times must cover the whole day exactly once. ${problem}.`)
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.shiftDefinition.update({ where: { id: Number(u.id) }, data: { name: u.name, startTime: u.startTime, endTime: u.endTime } })
    }
    await writeAudit(tx, {
      userId: actor.id, entity: 'ShiftDefinition', action: 'UPDATE',
      before: existing.map(toShiftDefinitionDto), after: merged.map(toShiftDefinitionDto), ip,
    })
  })
  publish('config', 'audit')
  return listShiftDefinitions()
}

// ---- Escalation rules ----

export async function listEscalationRules(): Promise<EscalationRuleDto[]> {
  const rows = (await prisma.escalationRule.findMany()).map(toEscalationRuleDto)
  return rows.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
}

export async function updateEscalationRules(actor: SessionUser, rules: EscalationRuleInput[], ip: string | null) {
  const before = await listEscalationRules()
  await prisma.$transaction(async (tx) => {
    for (const r of rules) {
      const data = { isRequired: r.isRequired, notifyWho: r.notifyWho || null, withinMinutes: r.withinMinutes }
      await tx.escalationRule.upsert({ where: { severity: r.severity as Severity }, create: { severity: r.severity, ...data }, update: data })
    }
    await writeAudit(tx, { userId: actor.id, entity: 'EscalationRule', action: 'UPDATE', before, after: rules, ip })
  })
  publish('config', 'audit')
  return listEscalationRules()
}

// ---- Lookup lists ----

const lookupTaken = () => new AppError('CONFLICT', 'This value is already in the list', { value: 'Already in the list' })

export async function listLookups(q: { listType?: LookupType; active?: 'true' | 'false' }): Promise<LookupItemDto[]> {
  const rows = await prisma.lookupItem.findMany({
    where: { listType: q.listType, isActive: activeFilter(q.active) },
    orderBy: [{ listType: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
  })
  return rows.map(toLookupDto)
}

export async function createLookup(actor: SessionUser, input: CreateLookupInput, ip: string | null): Promise<LookupItemDto> {
  const max = await prisma.lookupItem.aggregate({ where: { listType: input.listType }, _max: { sortOrder: true } })
  const sortOrder = input.sortOrder ?? (max._max.sortOrder ?? 0) + 1
  try {
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.lookupItem.create({ data: { listType: input.listType, value: input.value, sortOrder } })
      await writeAudit(tx, { userId: actor.id, entity: 'LookupItem', entityId: created.id, action: 'CREATE', after: toLookupDto(created), ip })
      return created
    })
    publish('config', 'audit')
    return toLookupDto(item)
  } catch (err) {
    if (isUniqueViolation(err)) throw lookupTaken()
    throw err
  }
}

export async function updateLookup(actor: SessionUser, id: number, input: UpdateLookupInput, ip: string | null): Promise<LookupItemDto> {
  const existing = await prisma.lookupItem.findUnique({ where: { id } })
  if (!existing) throw new AppError('NOT_FOUND', 'List item not found')
  try {
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.lookupItem.update({ where: { id }, data: input })
      await writeAudit(tx, { userId: actor.id, entity: 'LookupItem', entityId: id, action: 'UPDATE', before: toLookupDto(existing), after: toLookupDto(updated), ip })
      return updated
    })
    publish('config', 'audit')
    return toLookupDto(item)
  } catch (err) {
    if (isUniqueViolation(err)) throw lookupTaken()
    throw err
  }
}

// ---- Vehicles ----

const vehicleTaken = () => new AppError('CONFLICT', 'A vehicle with this ID already exists', { unitId: 'Already registered' })

export async function listVehicles(q: { active?: 'true' | 'false' }): Promise<VehicleDto[]> {
  const rows = await prisma.vehicle.findMany({ where: { isActive: activeFilter(q.active) }, orderBy: { unitId: 'asc' } })
  return rows.map(toVehicleDto)
}

export async function createVehicle(actor: SessionUser, input: CreateVehicleInput, ip: string | null): Promise<VehicleDto> {
  try {
    const v = await prisma.$transaction(async (tx) => {
      const created = await tx.vehicle.create({ data: { unitId: input.unitId, description: input.description ?? null } })
      await writeAudit(tx, { userId: actor.id, entity: 'Vehicle', entityId: created.id, action: 'CREATE', after: toVehicleDto(created), ip })
      return created
    })
    publish('config', 'audit')
    return toVehicleDto(v)
  } catch (err) {
    if (isUniqueViolation(err)) throw vehicleTaken()
    throw err
  }
}

export async function updateVehicle(actor: SessionUser, id: number, input: UpdateVehicleInput, ip: string | null): Promise<VehicleDto> {
  const existing = await prisma.vehicle.findUnique({ where: { id } })
  if (!existing) throw new AppError('NOT_FOUND', 'Vehicle not found')
  try {
    const v = await prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({ where: { id }, data: input })
      await writeAudit(tx, { userId: actor.id, entity: 'Vehicle', entityId: id, action: 'UPDATE', before: toVehicleDto(existing), after: toVehicleDto(updated), ip })
      return updated
    })
    publish('config', 'audit')
    return toVehicleDto(v)
  } catch (err) {
    if (isUniqueViolation(err)) throw vehicleTaken()
    throw err
  }
}
