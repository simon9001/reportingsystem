// Optional demo data for a development database: a mobile weighbridge unit and a place it often works at.
// Not part of `pnpm db:seed` (which runs on every Render deploy).
import '../src/loadEnv'
import { prisma } from '../src/lib/prisma'

await prisma.vehicle.upsert({ where: { unitId: 'KDG 143S' }, create: { unitId: 'KDG 143S', description: 'Mobile weighbridge unit' }, update: {} })
const last = await prisma.lookupItem.findFirst({ where: { listType: 'LOCATION' }, orderBy: { sortOrder: 'desc' } })
await prisma.lookupItem.upsert({
  where: { listType_value: { listType: 'LOCATION', value: 'Mlolongo' } },
  create: { listType: 'LOCATION', value: 'Mlolongo', sortOrder: (last?.sortOrder ?? 0) + 1 },
  update: {},
})
console.log('Sample vehicle KDG 143S and location Mlolongo are in place.')
await prisma.$disconnect()
