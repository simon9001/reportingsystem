import type { IncidentListItemDto, Paged } from '@sr/shared'
import ExcelJS from 'exceljs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { resetDb } from './db'
import { call, loginAs } from './factories'
import { buildIncidentWorkbook, safeText } from '../src/incidents/export'
import { incidentQuerySchema } from '@sr/shared'
import { insertIncident, resetIncidentSeq, setupIncidentWorld } from './incidentFixtures'

const app = createApp()

describe('incident explorer', () => {
  let world: Awaited<ReturnType<typeof setupIncidentWorld>>
  let cookie: string

  beforeEach(async () => {
    resetIncidentSeq()
    await resetDb()
    world = await setupIncidentWorld()
    cookie = (await loginAs(app, 'DEPUTY_DIRECTOR')).cookie
    await insertIncident(world, { occurredAt: '2026-08-29T22:15:00.000Z', severity: 'HIGH', description: 'Camera WB04 went offline' }) // 30/08 01:15 Nairobi
    await insertIncident(world, { occurredAt: '2026-08-30T20:00:00.000Z', severity: 'LOW', description: 'Blurry image', status: 'RESOLVED' }) // 30/08 23:00
    await insertIncident(world, { occurredAt: '2026-08-30T21:30:00.000Z', severity: 'MEDIUM', categoryValue: 'Network', locationValue: 'Server room' }) // 31/08 00:30
  })
  afterAll(() => prisma.$disconnect())

  const get = async (qs: string) => (await (await call(app, 'GET', `/api/incidents?${qs}`, { cookie })).json()) as Paged<IncidentListItemDto>

  it('filters by local day, including events just after midnight', async () => {
    const page = await get('from=2026-08-30&to=2026-08-30')
    expect(page.items).toHaveLength(2)
    expect(page.total).toBe(2)
  })

  it('filters by severity, status, category and location, and searches text', async () => {
    expect((await get('severity=HIGH,MEDIUM')).total).toBe(2)
    expect((await get('status=RESOLVED')).total).toBe(1)
    const network = await prisma.lookupItem.findFirstOrThrow({ where: { listType: 'CATEGORY', value: 'Network' } })
    expect((await get(`categoryId=${network.id}`)).total).toBe(1)
    expect((await get('q=wb04')).total).toBe(1)
    expect((await get('q=server room')).total).toBe(1)
    expect((await get('q=INC-2026-0002')).total).toBe(1)
  })

  it('sorts by severity rank and paginates', async () => {
    const bySeverity = await get('sort=-severity')
    expect(bySeverity.items.map((i) => i.severity)).toEqual(['HIGH', 'MEDIUM', 'LOW'])
    const newest = await get('pageSize=25&page=1')
    expect(newest.items[0]!.occurredAt).toBe('2026-08-30T21:30:00.000Z')
    expect((await get('page=2')).items).toHaveLength(0)
  })

  it('rejects invalid filters', async () => {
    expect((await call(app, 'GET', '/api/incidents?severity=URGENT', { cookie })).status).toBe(400)
  })

  it('exports the filtered rows to Excel for the Deputy Director only', async () => {
    const res = await call(app, 'GET', '/api/incidents/export.xlsx?from=2026-08-30&to=2026-08-30', { cookie })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Incidents')!
    expect(ws.getRow(1).getCell(1).value).toBe('Incident')
    expect(ws.rowCount).toBe(3) // header + 2
    const officer = await loginAs(app, 'OFFICER')
    expect((await call(app, 'GET', '/api/incidents/export.xlsx', { cookie: officer.cookie })).status).toBe(403)
  })
  it('adds an About sheet to the export', async () => {
    const res = await call(app, 'GET', '/api/incidents/export.xlsx?from=2026-08-30&to=2026-08-30', { cookie })
    expect(res.headers.get('x-export-truncated')).toBeNull()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const about = wb.getWorksheet('About')!
    expect(String(about.getRow(2).getCell(1).value)).toContain('from 2026-08-30')
    expect(String(about.getRow(3).getCell(1).value)).toBe('Rows: 2')
  })

  it('flags truncated exports', async () => {
    const { buffer, truncated } = await buildIncidentWorkbook(incidentQuerySchema.parse({}), 1)
    expect(truncated).toBe(true)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    expect(wb.getWorksheet('Incidents')!.rowCount).toBe(2)
    expect(String(wb.getWorksheet('About')!.getRow(4).getCell(1).value)).toContain('Only the first 1 matching')
  })

  it('neutralises spreadsheet formulas without mangling ordinary text', () => {
    expect(safeText('=HYPERLINK("x")')).toBe("'=HYPERLINK(\"x\")")
    expect(safeText('  =1+1')).toBe("'  =1+1")
    expect(safeText('\t=cmd')).toBe("'\t=cmd")
    expect(safeText('\r\n=cmd')).toBe("'\r\n=cmd")
    expect(safeText('-ve reading on camera 4')).toBe('-ve reading on camera 4')
    expect(safeText('+254 700 000000')).toBe('+254 700 000000')
    expect(safeText('@ICT desk')).toBe('@ICT desk')
    expect(safeText('Camera')).toBe('Camera')
    expect(safeText(null)).toBeNull()
  })
})
