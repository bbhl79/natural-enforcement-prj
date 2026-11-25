// 幂等种子：固定点位 ON CONFLICT DO NOTHING（重复执行同结果）
// 地理背景：广东省广州市（项目为广州市自然资源部门开发）
import { PrismaService } from '../prisma/prisma.service.js'

const POINTS = [
  { name: '越秀公园执法点', lat: 23.136, lng: 113.265 },
  { name: '沙面执法点', lat: 23.109, lng: 113.243 },
  { name: '珠江新城执法点', lat: 23.1197, lng: 113.321 },
  { name: '广州塔执法点', lat: 23.1065, lng: 113.3245 },
  { name: '天河体育中心执法点', lat: 23.135, lng: 113.322 },
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
