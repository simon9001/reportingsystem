import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { renderReportPdf } from './pdf'
import { loadReportDto } from './service'

const root = () => path.resolve(env.SR_REPORT_DIR)
function safePath(storedName: string): string {
  const full = path.resolve(root(), storedName)
  if (!full.startsWith(root() + path.sep)) throw new Error('Invalid stored file name')
  return full
}

/** The stored PDF of a submitted report; renders and stores it when missing or unreadable. */
export async function ensureSubmittedPdf(reportId: number): Promise<Buffer> {
  const row = await prisma.shiftReport.findUniqueOrThrow({ where: { id: reportId }, select: { pdfStoredName: true, status: true } })
  if (row.status !== 'SUBMITTED') throw new Error('Report is not submitted')
  if (row.pdfStoredName) {
    try { return await readFile(safePath(row.pdfStoredName)) } catch { /* re-render below */ }
  }
  const dto = await loadReportDto(reportId)
  const buf = await renderReportPdf(dto, { draft: false, generatedAt: new Date(), timeZone: env.SR_APP_TIMEZONE })
  const storedName = `${reportId}-${randomUUID()}.pdf`
  await mkdir(root(), { recursive: true })
  await writeFile(safePath(storedName), buf)
  await prisma.shiftReport.update({ where: { id: reportId }, data: { pdfStoredName: storedName } })
  return buf
}

/** Submitted → stored PDF; draft → freshly rendered with the DRAFT watermark (never stored). */
export async function reportPdf(reportId: number, now = new Date()): Promise<Buffer> {
  const dto = await loadReportDto(reportId, now)
  if (dto.status === 'SUBMITTED') return ensureSubmittedPdf(reportId)
  return renderReportPdf(dto, { draft: true, generatedAt: now, timeZone: env.SR_APP_TIMEZONE })
}
