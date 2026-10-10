// dev db seed：本切片最小种子（#49）。
// 地基无业务实体（#47 G1），身份组织参考数据归 #52；本文件只造「验证迁移/种子通道」所需的
// 极简探针数据，且幂等——已存在即跳过（dev db 全语义只增不改，毁数入口只有 dev db reset）。
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const existing = await prisma.migrationProbe.findFirst({ where: { note: "seed-probe" } });
if (existing) {
  console.log("种子已存在，跳过。");
} else {
  await prisma.migrationProbe.create({ data: { note: "seed-probe" } });
  console.log("种子已写入。");
}

await prisma.$disconnect();
