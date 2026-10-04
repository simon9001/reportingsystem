import { describe, expect, it } from 'vitest'
import { incidentPlace, INCIDENT_REF_PREFIX } from '../src'

describe('incidentPlace', () => {
  it('shows the listed location, else the typed place, else nothing', () => {
    expect(incidentPlace({ location: { id: 1, value: 'Isinya W.B' }, locationText: null })).toBe('Isinya W.B')
    expect(incidentPlace({ location: null, locationText: 'Mlolongo' })).toBe('Mlolongo')
    expect(incidentPlace({ location: null, locationText: null })).toBe('')
  })
  it('numbers static and mobile incidents with their own prefixes', () => {
    expect(INCIDENT_REF_PREFIX).toEqual({ STATIC: 'INC', MOBILE: 'MWB' })
  })
})
