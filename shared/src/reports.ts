import { REPORT_CONFIRMATIONS } from './constants'
import type { ReportFieldsDto } from './dto'

/** Field → message for everything that blocks submitting. Shared by the server check and the submit button. */
export function reportSubmitProblems(f: ReportFieldsDto): Record<string, string> {
  const out: Record<string, string> = {}
  if (!f.overallStatus) out.overallStatus = 'Choose the overall status'
  if (!f.overview?.trim()) out.overview = 'Write the shift overview'
  for (const c of REPORT_CONFIRMATIONS) if (!f[c.key]) out[c.key] = 'Confirm this before submitting'
  return out
}
