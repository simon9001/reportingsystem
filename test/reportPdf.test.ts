import type { ReportIncidentRowDto, ShiftReportDto } from '@sr/shared'
import { describe, expect, it } from 'vitest'
import { fmtDateTime, fmtShiftDate } from '../src/reports/format'
import { renderReportPdf, reportPdfFileName } from '../src/reports/pdf'

const row = (i: number): ReportIncidentRowDto => ({
  id: i, ref: `INC-2026-${String(i).padStart(4, '0')}`, side: 'STATIC', occurredAt: '2026-10-11T06:00:00.000Z',
  place: 'Weighbridge 04 · Camera 3', category: 'CCTV', severity: i % 4 === 0 ? 'HIGH' : 'LOW', status: 'OPEN', escalationResult: 'NOT_REQUIRED',
})

function report(incidents: number, status: 'DRAFT' | 'SUBMITTED' = 'SUBMITTED'): ShiftReportDto {
  const rows = Array.from({ length: incidents }, (_, i) => row(i + 1))
  return {
    id: 42, shiftId: 7, status, overdue: false, updatedAt: '2026-10-11T14:10:00.000Z', submitOpensAt: '2026-10-11T13:30:00.000Z', canEdit: false, canSubmit: false,
    submittedBy: { id: 1, fullName: 'Brian Otieno' }, submittedAt: '2026-10-11T14:08:00.000Z', timeliness: 'ON_TIME', lateMinutes: null,
    fields: {
      overallStatus: 'MINOR_ISSUES', overview: 'A long overview. '.repeat(80), keyEvents: 'WB04 camera restarted', pendingActions: null,
      operationalConcerns: 'Power dips <script>', recommendations: null,
      confirmReviewed: true, confirmEscalated: true, confirmHandedOver: true, confirmSubmitted: true,
    },
    content: {
      shift: { id: 7, shiftDate: '2026-10-11', shiftCode: 'DAY', shiftName: 'Day', startsAt: '2026-10-11T05:00:00.000Z', endsAt: '2026-10-11T14:00:00.000Z', supervisor: { id: 1, fullName: 'Brian Otieno' }, officer: { id: 2, fullName: 'Mary Wambui' } },
      deadline: '2026-10-11T14:30:00.000Z',
      figures: {
        total: incidents, bySeverity: { LOW: incidents, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }, byStatus: { OPEN: incidents, IN_PROGRESS: 0, MONITORING: 0, RESOLVED: 0, CLOSED: 0 },
        bySide: { STATIC: incidents, MOBILE: 0 }, byCategory: [{ label: 'CCTV', count: incidents }],
        escalation: { NOT_REQUIRED: incidents, NOT_ESCALATED: 0, ESCALATED: 0, ON_TIME: 0, LATE: 0 }, avgMinutesToResolve: null, openAtEnd: incidents,
      },
      criticalHigh: rows.filter((r) => r.severity === 'HIGH'), open: rows, incidents: rows,
      checks: incidents ? [{ code: 'OPEN_WITHOUT_PENDING_ACTIONS', message: 'Incidents are still open', ref: null }] : [],
    },
  }
}

const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
const opts = { generatedAt: new Date('2026-10-11T14:09:00Z'), timeZone: 'Africa/Nairobi', compress: false }

describe('report PDF', () => {
  it('formats dates in the app time zone', () => {
    expect(fmtShiftDate('2026-10-11')).toBe('11 Oct 2026')
    expect(fmtDateTime('2026-10-11T14:08:00.000Z', 'Africa/Nairobi')).toBe('11 Oct 2026, 17:08')
  })
  it('renders a valid PDF for an empty shift and for a draft', async () => {
    const empty = await renderReportPdf(report(0), { ...opts, draft: false })
    expect(empty.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pages(empty)).toBeGreaterThanOrEqual(1)
    const draft = await renderReportPdf(report(3, 'DRAFT'), { ...opts, draft: true })
    expect(draft.subarray(0, 5).toString()).toBe('%PDF-')
  })
  it('adds pages for many incidents and long text', async () => {
    const few = pages(await renderReportPdf(report(3), { ...opts, draft: false }))
    const many = pages(await renderReportPdf(report(120), { ...opts, draft: false }))
    expect(many).toBeGreaterThan(few)
  })
  it('names the file after the shift', () => {
    expect(reportPdfFileName(report(0))).toBe('Shift-report-2026-10-11-DAY.pdf')
  })
})
