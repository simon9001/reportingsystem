import type { EscalationRuleDto, LookupItemDto, LookupType, Severity, ShiftDefinitionDto, VehicleDto } from '@sr/shared'
import type { EscalationRule, LookupItem, ShiftDefinition, Vehicle } from '../generated/prisma/client'

export const toShiftDefinitionDto = (d: ShiftDefinition): ShiftDefinitionDto => ({
  id: d.id, code: d.code, name: d.name, startTime: d.startTime, endTime: d.endTime, sortOrder: d.sortOrder, isActive: d.isActive,
})

export const toEscalationRuleDto = (r: EscalationRule): EscalationRuleDto => ({
  severity: r.severity as Severity, isRequired: r.isRequired, notifyWho: r.notifyWho, withinMinutes: r.withinMinutes,
})

export const toLookupDto = (l: LookupItem): LookupItemDto => ({
  id: l.id, listType: l.listType as LookupType, value: l.value, sortOrder: l.sortOrder, isActive: l.isActive,
})

export const toVehicleDto = (v: Vehicle): VehicleDto => ({ id: v.id, unitId: v.unitId, description: v.description, isActive: v.isActive })
