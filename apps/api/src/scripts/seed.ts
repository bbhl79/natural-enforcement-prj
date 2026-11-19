// 幂等种子：固定点位 ON CONFLICT DO NOTHING（重复执行同结果）
import { PrismaService } from '../prisma/prisma.service.js'

const POINTS = [
  { name: '天安门执法点', lat: 39.9087, lng: 116.3975 },
  { name: '中关村执法点', lat: 39.9847, lng: 116.3159 },
  { name: '国贸执法点', lat: 39.9087, lng: 116.461 },
  { name: '西单执法点', lat: 39.9086, lng: 116.3743 },
  { name: '五道口执法点', lat: 39.9925, lng: 116.3381 },
]

async function main(): Promise<void> {
  const db = new PrismaService()
  for (const p of POINTS) {
    await db.$executeRaw`
      INSERT INTO "EnforcementPoint" ("name", "location")
      VALUES (${p.name}, ST_SetSRID(ST_Point(${p.lng}, ${p.lat}), 4326)::geography)
      ON CONFLICT ("name") DO NOTHING`
  }
  await db.$disconnect()
  console.log(JSON.stringify({ seeded: POINTS.length, mode: 'idempotent' }))
}

void main()
