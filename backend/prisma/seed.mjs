// dev db seed：迁移/种子通道验证探针（#49）+ 身份组织参考数据（#52）。
// 幂等纪律（dev db 全语义只增不改，毁数入口只有 dev db reset）：按业务 code 判存在即跳过。
// 身份组织参考数据 = E2 越权必失败矩阵的燃料：总队机关 + 两个平行支队 + 主管/经办各一，
// 口令散列 = argon2 0.45.1（infra/VERSIONS.md 身份行；种子运行即预编译二进制实测腿之一）。
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "argon2";

// ULID 生成（#16 §1.1 主键形制：48bit 毫秒时间 + 80bit 随机，26 位大写 Crockford Base32）。
// 与 backend/identity/src/domain/ulid.ts 同规则，但种子通道不 import 模块代码：
// shield 出口内部以 .js 扩展做 NodeNext 风格重导出，node 原生 ESM 不做 .js→.ts 改写，
// 模块源码只由 vitest/vite 解析。此处维护一份等价实现（同常量、同形制自检）。
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function newUlid() {
  let time = BigInt(Date.now());
  let id = "";
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  // 随机部 16 字符：按字节各映射一字符（256 = 8×32 整除，无偏），16 字节 → 16 字符
  const random = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of random) id += CROCKFORD[byte % 32];
  if (!ULID_PATTERN.test(id)) throw new Error("ULID 生成结果不符合 #16 §1.1 形制");
  return id;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const existing = await prisma.migrationProbe.findFirst({ where: { note: "seed-probe" } });
if (existing) {
  console.log("种子已存在，跳过。");
} else {
  await prisma.migrationProbe.create({ data: { note: "seed-probe" } });
  console.log("种子已写入。");
}

// ---- 身份组织参考数据（#52；与 integration/e2-access-matrix.test.ts 的 code 约定同步） ----
const SEED_PASSWORD = "Seed-pass-52"; // 仅开发环境种子口令，首登改密归后续切片

/** 机构：存在即复用（返回 id），否则建当前行 + v1 名称版本行 */
async function seedOrgUnit(code, name, parentId = null) {
  const found = await prisma.orgUnit.findUnique({ where: { code } });
  if (found) return found.id;
  const id = newUlid();
  await prisma.orgUnit.create({ data: { id, code, name, parentId } });
  await prisma.orgUnitNameVersion.create({
    data: { id: newUlid(), orgUnitId: id, name, version: 1 },
  });
  console.log(`种子机构 ${code} 已写入。`);
  return id;
}

/** 人员：存在即跳过；否则建当前行 + v1 名称版本行 + 首条任职（当前 = ended_at NULL） */
async function seedPersonnel(code, name, orgUnitId, role, passwordHash) {
  const found = await prisma.personnel.findUnique({ where: { code } });
  if (found) return;
  const id = newUlid();
  await prisma.personnel.create({
    data: { id, code, name, orgUnitId, role, passwordHash },
  });
  await prisma.personnelNameVersion.create({
    data: { id: newUlid(), personnelId: id, name, version: 1 },
  });
  await prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId },
  });
  console.log(`种子人员 ${code} 已写入。`);
}

const hqId = await seedOrgUnit("ORG-HQ", "自然执法总队", null);
const deptAId = await seedOrgUnit("ORG-DEPT-A", "第一执法支队", hqId);
const deptBId = await seedOrgUnit("ORG-DEPT-B", "第二执法支队", hqId);

const passwordHash = await hash(SEED_PASSWORD);
await seedPersonnel("P-SUP-A", "甲主管", deptAId, "supervisor", passwordHash);
await seedPersonnel("P-CLERK-A", "乙经办", deptAId, "clerk", passwordHash);
await seedPersonnel("P-CLERK-B", "丙经办", deptBId, "clerk", passwordHash);

await prisma.$disconnect();
