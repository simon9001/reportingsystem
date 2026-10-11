import type { ShiftReportDto } from '@sr/shared'
import { describe, expect, it } from 'vitest'
import { escapeHtml, reportOverdueDdEmail, reportOverdueSupervisorEmail, reportSubmittedEmail, testEmail } from '../src/email/templates'

const ctx = { appBaseUrl: 'https://cr.kenha.test', timeZone: 'Africa/Nairobi' }
const base: ShiftReportDto = {
  id: 9, shiftId: 3, status: 'SUBMITTED', overdue: false, updatedAt: '2026-10-11T14:10:00.000Z', submitOpensAt: '2026-10-11T13:30:00.000Z', canEdit: false, canSubmit: false,
  submittedBy: { id: 1, fullName: 'Brian Otieno' }, submittedAt: '2026-10-11T14:08:00.000Z', timeliness: 'ON_TIME', lateMinutes: null,
  fields: {
    overallStatus: 'MINOR_ISSUES', overview: 'Camera <script>alert(1)</script> & power dips', keyEvents: null, pendingActions: null,
    operationalConcerns: null, recommendations: null, confirmReviewed: true, confirmEscalated: true, confirmHandedOver: true, confirmSubmitted: true,
  },
  content: {
    shift: { id: 3, shiftDate: '2026-10-11', shiftCode: 'DAY', shiftName: 'Day', startsAt: '2026-10-11T05:00:00.000Z', endsAt: '2026-10-11T14:00:00.000Z', supervisor: { id: 1, fullName: 'Brian Otieno' }, officer: { id: 2, fullName: 'Mary Wambui' } },
    deadline: '2026-10-11T14:30:00.000Z',
    figures: {
      total: 2, bySeverity: { LOW: 1, MEDIUM: 0, HIGH: 1, CRITICAL: 0 }, byStatus: { OPEN: 1, IN_PROGRESS: 0, MONITORING: 0, RESOLVED: 1, CLOSED: 0 },
      bySide: { STATIC: 2, MOBILE: 0 }, byCategory: [{ label: 'CCTV', count: 2 }],
      escalation: { NOT_REQUIRED: 1, NOT_ESCALATED: 0, ESCALATED: 0, ON_TIME: 1, LATE: 0 }, avgMinutesToResolve: 25, openAtEnd: 1,
    },
    criticalHigh: [{ id: 1, ref: 'INC-2026-0001', side: 'STATIC', occurredAt: '2026-10-11T06:00:00.000Z', place: 'Gate <b>1</b>', category: 'CCTV & Co', severity: 'HIGH', status: 'RESOLVED', escalationResult: 'ON_TIME' }],
    open: [], incidents: [], checks: [],
  },
}

describe('email templates', () => {
  it('escapes HTML', () => expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;'))

  it('builds the submitted email with subject, escaped overview, figures, link and plain text', () => {
    const m = reportSubmittedEmail(base, ctx)
    expect(m.subject).toBe('Day shift report — 11 Oct 2026 — Submitted on time')
    expect(m.html).toContain('Camera &lt;script&gt;alert(1)&lt;/script&gt; &amp; power dips')
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('https://cr.kenha.test/reports/9')
    expect(m.html).toContain('INC-2026-0001')
    expect(m.html).toContain('Gate &lt;b&gt;1&lt;/b&gt;')
    expect(m.html).toContain('CCTV &amp; Co')
    expect(m.html).not.toContain('<b>1</b>')
    expect(m.html).toContain('Minor issues')
    expect(m.text).toContain('Total incidents: 2')
    expect(m.text).toContain('https://cr.kenha.test/reports/9')
  })

  it('says how late a late report was', () => {
    expect(reportSubmittedEmail({ ...base, timeliness: 'LATE', lateMinutes: 12 }, ctx).subject).toBe('Day shift report — 11 Oct 2026 — Submitted 12 min late')
  })

  it('builds the overdue emails', () => {
    const draft = { ...base, status: 'DRAFT' as const, submittedAt: null, submittedBy: null, timeliness: null, overdue: true }
    const dd = reportOverdueDdEmail(draft, ctx)
    expect(dd.subject).toBe('Overdue: Day shift report — 11 Oct 2026 not submitted')
    expect(dd.html).toContain('Brian Otieno')
    expect(dd.html).toContain('17:30')
    const sup = reportOverdueSupervisorEmail(draft, ctx)
    expect(sup.subject).toBe('Reminder: submit the Day shift report for 11 Oct 2026')
    expect(sup.text).toContain('https://cr.kenha.test/reports/9')
  })

  it('builds the test email', () => {
    const t = testEmail({ host: 'smtp.office365.com', from: 'cr@kenha.test', sentAt: new Date('2026-10-11T09:00:00Z'), timeZone: 'Africa/Nairobi' })
    expect(t.subject).toBe('Control Room test email')
    expect(t.text).toContain('smtp.office365.com')
    expect(t.text).toContain('11 Oct 2026, 12:00')
  })
})
