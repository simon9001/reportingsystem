import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_INCIDENT, type UploadResultDto } from '@sr/shared'
import { writeAudit } from '../audit/audit'
import { publish } from '../events/bus'
import { AppError } from '../lib/errors'
import { prisma } from '../lib/prisma'
import { canEditIncident } from '../incidents/rules'
import { editableShiftIds, getIncident } from '../incidents/service'
import type { SessionUser } from '../types'
import { detectAllowedType, readStoredFile, removeStoredFile, saveFile } from './storage'

/** Cheap permission check, run before the request body is read. */
export async function assertCanUpload(actor: SessionUser, incidentId: number): Promise<void> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { shift: true } })
  if (!incident) throw new AppError('NOT_FOUND', 'Incident not found')
  if (!canEditIncident(actor, incident.shift, await editableShiftIds())) throw new AppError('FORBIDDEN', 'You cannot add snapshots to this incident')
}

export async function uploadAttachments(actor: SessionUser, incidentId: number, files: File[], ip: string | null): Promise<UploadResultDto> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { shift: true, _count: { select: { attachments: true } } } })
  if (!incident) throw new AppError('NOT_FOUND', 'Incident not found')
  if (!canEditIncident(actor, incident.shift, await editableShiftIds())) throw new AppError('FORBIDDEN', 'You cannot add snapshots to this incident')
  if (files.length === 0) throw new AppError('VALIDATION_ERROR', 'Choose at least one file', { files: 'Choose at least one file' })
  if (incident._count.attachments + files.length > MAX_ATTACHMENTS_PER_INCIDENT) {
    const message = `An incident can have at most ${MAX_ATTACHMENTS_PER_INCIDENT} snapshots (it has ${incident._count.attachments})`
    throw new AppError('VALIDATION_ERROR', message, { files: message })
  }

  // Validate every file first so nothing is stored when any file is rejected.
  const fields: Record<string, string> = Object.create(null)
  const accepted: { file: File; buf: Buffer; mime: string; ext: string }[] = []
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      fields[file.name] = 'Larger than 10 MB'
      continue
    }
    const buf = Buffer.from(await file.arrayBuffer())
    const type = await detectAllowedType(buf)
    if (!type) {
      fields[file.name] = 'Not a JPEG, PNG, WebP or PDF file'
      continue
    }
    accepted.push({ file, buf, ...type })
  }
  if (Object.keys(fields).length > 0) throw new AppError('VALIDATION_ERROR', 'Some files were not accepted', { ...fields })
  if (accepted.length === 0) throw new AppError('VALIDATION_ERROR', 'Choose at least one file', { files: 'Choose at least one file' })

  const stored: string[] = []
  try {
    for (const a of accepted) stored.push(await saveFile(a.buf, a.ext))
    await prisma.$transaction(async (tx) => {
      for (const [i, a] of accepted.entries()) {
        const row = await tx.incidentAttachment.create({
          data: { incidentId, storedName: stored[i]!, originalName: a.file.name.slice(0, 255), mimeType: a.mime, sizeBytes: a.buf.length, uploadedById: actor.id },
        })
        await writeAudit(tx, { userId: actor.id, entity: 'IncidentAttachment', entityId: row.id, action: 'CREATE', after: { incidentId, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes }, ip })
      }
      const names = accepted.map((a) => a.file.name).join(', ')
      await tx.incidentEvent.create({ data: { incidentId, userId: actor.id, kind: 'ATTACHMENT_ADDED', summary: `Added ${accepted.length} snapshot(s): ${names}`.slice(0, 300) } })
    })
  } catch (err) {
    await Promise.all(stored.map((s) => removeStoredFile(s)))
    throw err
  }
  publish('incidents', 'audit')
  const dto = await getIncident(String(incidentId), actor)
  return { attachments: dto.attachments.slice(-accepted.length) }
}

export async function deleteAttachment(actor: SessionUser, id: number, ip: string | null): Promise<void> {
  const att = await prisma.incidentAttachment.findUnique({ where: { id }, include: { incident: { include: { shift: true } } } })
  if (!att) throw new AppError('NOT_FOUND', 'Snapshot not found')
  const canEdit = canEditIncident(actor, att.incident.shift, await editableShiftIds())
  const allowed = actor.role === 'ADMIN' || (att.uploadedById === actor.id && canEdit)
  if (!allowed) throw new AppError('FORBIDDEN', 'You cannot remove this snapshot')
  await prisma.$transaction(async (tx) => {
    await tx.incidentAttachment.delete({ where: { id } })
    await tx.incidentEvent.create({ data: { incidentId: att.incidentId, userId: actor.id, kind: 'ATTACHMENT_REMOVED', summary: `Removed snapshot ${att.originalName}`.slice(0, 300) } })
    await writeAudit(tx, { userId: actor.id, entity: 'IncidentAttachment', entityId: id, action: 'DELETE', before: { incidentId: att.incidentId, originalName: att.originalName }, ip })
  })
  await removeStoredFile(att.storedName)
  publish('incidents', 'audit')
}

export async function getAttachmentFile(id: number): Promise<{ data: Buffer; mimeType: string; originalName: string }> {
  const att = await prisma.incidentAttachment.findUnique({ where: { id } })
  if (!att) throw new AppError('NOT_FOUND', 'Snapshot not found')
  return { data: await readStoredFile(att.storedName), mimeType: att.mimeType, originalName: att.originalName }
}
