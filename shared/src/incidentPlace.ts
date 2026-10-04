import type { LookupRef } from './dto'

/** Where an incident happened: the listed location (station or place), else the typed mobile place. */
export function incidentPlace(i: { location: LookupRef | null; locationText: string | null }): string {
  return i.location?.value ?? i.locationText ?? ''
}
