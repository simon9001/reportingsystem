import { addDays, type IncidentListItemDto, type IncidentQuery, type Paged } from '@sr/shared'
import type { Prisma } from '../generated/prisma/client'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { localTime } from '../lib/shiftTime'
import { listInclude, toIncidentListItem } from './mappers'

export function buildIncidentWhere(q: IncidentQuery, tz = env.SR_APP_TIMEZONE): Prisma.IncidentWhereInput {
  const occurredAt: Prisma.DateTimeFilter = {}
  if (q.from) occurredAt.gte = localTime(q.from, '00:00', tz)
  if (q.to) occurredAt.lt = localTime(addDays(q.to, 1), '00:00', tz)
  const text = q.q?.trim()
  return {
    ...(q.from || q.to ? { occurredAt } : {}),
    ...(q.severity ? { severity: { in: q.severity } } : {}),
    ...(q.status ? { status: { in: q.status } } : {}),
    ...(q.categoryId ? { categoryId: { in: q.categoryId } } : {}),
    ...(q.locationId ? { locationId: { in: q.locationId } } : {}),
    ...(q.shiftCode ? { shiftCode: q.shiftCode } : {}),
    ...(q.shiftId ? { shiftId: q.shiftId } : {}),
    ...(q.reportedById ? { reportedById: q.reportedById } : {}),
    ...(q.side ? { side: q.side } : {}),
    ...(q.vehicleId ? { vehicleId: { in: q.vehicleId } } : {}),
    ...(q.platformId ? { platformId: { in: q.platformId } } : {}),
    ...(q.vehicleStatus ? { vehicleStatus: { in: q.vehicleStatus } } : {}),
    ...(q.gpsStatus ? { gpsStatus: { in: q.gpsStatus } } : {}),
    ...(q.dashcamStatus ? { dashcamStatus: { in: q.dashcamStatus } } : {}),
    ...(q.hasAttachments === 'true' ? { attachments: { some: {} } } : q.hasAttachments === 'false' ? { attachments: { none: {} } } : {}),
    ...(text
      ? {
          OR: [
            { ref: { contains: text } },
            { description: { contains: text } },
            { locationDetail: { contains: text } },
            { location: { value: { contains: text } } },
            { category: { value: { contains: text } } },
            { reportedBy: { fullName: { contains: text } } },
            { locationText: { contains: text } },
            { remarks: { contains: text } },
            { vehicle: { unitId: { contains: text } } },
            { platform: { value: { contains: text } } },
          ],
        }
      : {}),
  }
}

export function incidentOrderBy(sort: IncidentQuery['sort']): Prisma.IncidentOrderByWithRelationInput[] {
  const dir = sort.startsWith('-') ? 'desc' : 'asc'
  const field = sort.replace(/^-/, '')
  const primary: Prisma.IncidentOrderByWithRelationInput =
    field === 'severity' ? { severityRank: dir }
      : field === 'status' ? { status: dir }
        : field === 'ref' ? { ref: dir }
          : field === 'side' ? { side: dir }
            : { occurredAt: dir }
  return [primary, { id: 'desc' }]
}

export async function listIncidents(q: IncidentQuery): Promise<Paged<IncidentListItemDto>> {
  const where = buildIncidentWhere(q)
  const [total, rows] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({ where, include: listInclude, orderBy: incidentOrderBy(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ])
  return { items: rows.map(toIncidentListItem), total, page: q.page, pageSize: q.pageSize }
}
