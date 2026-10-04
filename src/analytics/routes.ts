import { analyticsQuerySchema, sideQuerySchema, type IncidentSide } from '@sr/shared'
import { Hono, type Context } from 'hono'
import { requireRole } from '../auth/middleware'
import { parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import {
  incidentAttention, incidentDayNight, incidentHotspots, incidentMobileHealth, incidentsByCategory, incidentsBySeverity, incidentsByVehicle,
  incidentSideTrend, incidentSummary, incidentTrend,
} from './service'

export const analyticsRoutes = new Hono<AppEnv>()
analyticsRoutes.use('*', requireRole('DEPUTY_DIRECTOR', 'ADMIN'))

const withPeriod = <T,>(fn: (from: string, to: string, side?: IncidentSide) => Promise<T>) => async (c: Context<AppEnv>) => {
  const { from, to, side } = parseQuery(c, analyticsQuerySchema)
  return c.json(await fn(from, to, side))
}

analyticsRoutes.get('/incidents/summary', withPeriod((f, t, s) => incidentSummary(f, t, s)))
analyticsRoutes.get('/incidents/trend', withPeriod((f, t, s) => incidentTrend(f, t, s)))
analyticsRoutes.get('/incidents/by-side-trend', withPeriod((f, t) => incidentSideTrend(f, t)))
analyticsRoutes.get('/incidents/by-severity', withPeriod((f, t, s) => incidentsBySeverity(f, t, s)))
analyticsRoutes.get('/incidents/by-category', withPeriod((f, t, s) => incidentsByCategory(f, t, s)))
analyticsRoutes.get('/incidents/by-location', withPeriod((f, t, s) => incidentHotspots(f, t, s)))
analyticsRoutes.get('/incidents/by-vehicle', withPeriod((f, t) => incidentsByVehicle(f, t)))
analyticsRoutes.get('/incidents/mobile-health', withPeriod((f, t) => incidentMobileHealth(f, t)))
analyticsRoutes.get('/incidents/day-night', withPeriod((f, t, s) => incidentDayNight(f, t, s)))
analyticsRoutes.get('/incidents/attention', async (c) => c.json(await incidentAttention(parseQuery(c, sideQuerySchema).side)))
