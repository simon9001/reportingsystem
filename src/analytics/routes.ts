import { analyticsQuerySchema } from '@sr/shared'
import { Hono, type Context } from 'hono'
import { requireRole } from '../auth/middleware'
import { parseQuery } from '../lib/validate'
import type { AppEnv } from '../types'
import {
  incidentAttention, incidentDayNight, incidentHotspots, incidentsByCategory, incidentsBySeverity, incidentSummary, incidentTrend,
} from './service'

export const analyticsRoutes = new Hono<AppEnv>()
analyticsRoutes.use('*', requireRole('DEPUTY_DIRECTOR', 'ADMIN'))

const withPeriod = <T,>(fn: (from: string, to: string) => Promise<T>) => async (c: Context<AppEnv>) => {
  const { from, to } = parseQuery(c, analyticsQuerySchema)
  return c.json(await fn(from, to))
}

analyticsRoutes.get('/incidents/summary', withPeriod((f, t) => incidentSummary(f, t)))
analyticsRoutes.get('/incidents/trend', withPeriod(incidentTrend))
analyticsRoutes.get('/incidents/by-severity', withPeriod(incidentsBySeverity))
analyticsRoutes.get('/incidents/by-category', withPeriod((f, t) => incidentsByCategory(f, t)))
analyticsRoutes.get('/incidents/by-location', withPeriod((f, t) => incidentHotspots(f, t)))
analyticsRoutes.get('/incidents/day-night', withPeriod(incidentDayNight))
analyticsRoutes.get('/incidents/attention', async (c) => c.json(await incidentAttention()))
