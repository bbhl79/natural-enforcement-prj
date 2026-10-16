// dev db seed：迁移探针（#49）+ 参照种子（#92）+ 开发测试夹具（#52）。
// 幂等纪律（dev db 全语义只增不改，毁数入口只有 dev db reset）：按业务键判存在即跳过。
// 参照种子（七个角色、操作码名册、允许行）在所有环境写入。允许行以 GitHub issue #71 决议为准。
// 开发测试夹具（机构与人员）只在非生产环境写入。生产环境设置 NODE_ENV=production。
// 夹具人员保留旧 role 列。手机号有值。passwordChangedAt 留空。口令符合口令策略。
// 口令散列 = argon2 0.45.1（infra/VERSIONS.md 身份行；种子运行即预编译二进制实测腿之一）。
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "argon2";

// ULID 生成（#16 §1.1 主键形制：48bit 毫秒时间 + 80bit 随机，26 位大写 Crockford Base32）。
// 与 backend/identity/src/domain/ulid.ts 同规则，但种子通道不 import 模块代码：
// shield 出口内部以 .js 扩展做 NodeNext 风格重导出，node 原生 ESM 不做 .js→.ts 改写，
// 模块源码只由 vitest/vite 解析。此处维护一份等价实现（同常量、同形制自检）。
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

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
  await prisma.migrationProbe.create({ data: { id: newUlid(), note: "seed-probe" } });
  console.log("种子已写入。");
}

// ---- 参照种子（#92；允许行 = GitHub issue #71 决议）----
// 系统管理不持有办案表任何一行。authz.binding 两条只给系统管理。
const ROLE_ALLOWANCES = {
  内勤: [
    "clue.org.assign",
    "clue.handler.assign",
    "case.reassign.submit",
    "clue.read",
    "case.read",
    "doc.read",
  ],
  经办: [
    "clue.verify.start",
    "case.open",
    "doc.draft",
    "doc.submit",
    "case.reassign.submit",
    "legal.review.request",
    "clue.read",
    "case.read",
    "doc.read",
    "clue.export",
    "case.export",
    "doc.export",
  ],
  法制审核: [
    "legal.opinion.draft",
    "legal.opinion.submit",
    "clue.read",
    "case.read",
    "doc.read",
    "clue.export",
    "case.export",
    "doc.export",
  ],
  行政审核: [
    "legal.review.request",
    "doc.admin.review",
    "clue.read",
    "case.read",
    "doc.read",
    "clue.export",
    "case.export",
    "doc.export",
  ],
  行政审批: [
    "legal.review.request",
    "doc.approve",
    "clue.read",
    "case.read",
    "doc.read",
    "clue.export",
    "case.export",
    "doc.export",
  ],
  监督: [
    "clue.read",
    "case.read",
    "doc.read",
    "clue.export",
    "case.export",
    "doc.export",
    "audit.admin.read",
    "audit.admin.export",
  ],
  系统管理: [
    ...["template", "rule", "calendar", "metric"].flatMap((object) =>
      ["submit", "approve", "void", "withdraw", "read"].map((action) => `cfg.${object}.${action}`),
    ),
    "personnel.locked.read",
    "personnel.locked.release",
    "personnel.password.reset",
    "audit.admin.read",
    "audit.admin.export",
    "authz.binding.submit",
    "authz.binding.approve",
  ],
};

async function seedRole(name) {
  const found = await prisma.role.findFirst({ where: { name, deactivatedAt: null } });
  if (found) return found.id;
  const id = newUlid();
  await prisma.role.create({ data: { id, name } });
  return id;
}

async function seedPermission(code) {
  const found = await prisma.permission.findFirst({ where: { code, deactivatedAt: null } });
  if (found) return found.id;
  const id = newUlid();
  await prisma.permission.create({ data: { id, code } });
  return id;
}

async function seedAllow(roleId, permissionId) {
  const found = await prisma.rolePermission.findFirst({
    where: { roleId, permissionId, deactivatedAt: null },
  });
  if (found) return;
  await prisma.rolePermission.create({ data: { id: newUlid(), roleId, permissionId } });
}

const roleIds = new Map();
for (const name of Object.keys(ROLE_ALLOWANCES)) {
  roleIds.set(name, await seedRole(name));
}
const permissionIds = new Map();
for (const code of new Set(Object.values(ROLE_ALLOWANCES).flat())) {
  permissionIds.set(code, await seedPermission(code));
}
for (const [name, codes] of Object.entries(ROLE_ALLOWANCES)) {
  const roleId = roleIds.get(name);
  for (const code of codes) {
    await seedAllow(roleId, permissionIds.get(code));
  }
}
console.log("参照种子已写入或已存在。");

// ---- 开发测试夹具（#52；与 integration/e2-access-matrix.test.ts 的 code 约定同步）----
// NODE_ENV=production 时不写入。夹具不进入生产库。
const SEED_PASSWORD = "Seed-pass-52"; // 长度 12，含大写、小写、数字、特殊字符。上次改密时间留空。

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

/** 人员：存在则只补空手机号；否则建当前行 + v1 名称版本行 + 首条任职。不写 passwordChangedAt。 */
async function seedPersonnel(code, name, orgUnitId, role, passwordHash, mobilePhone) {
  const found = await prisma.personnel.findUnique({ where: { code } });
  if (found) {
    if (found.mobilePhone == null) {
      await prisma.personnel.update({ where: { id: found.id }, data: { mobilePhone } });
      console.log(`种子人员 ${code} 已补手机号。`);
    }
    return;
  }
  const id = newUlid();
  await prisma.personnel.create({
    data: { id, code, name, orgUnitId, role, passwordHash, mobilePhone },
  });
  await prisma.personnelNameVersion.create({
    data: { id: newUlid(), personnelId: id, name, version: 1 },
  });
  await prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId },
  });
  console.log(`种子人员 ${code} 已写入。`);
}

if (process.env.NODE_ENV === "production") {
  console.log("生产环境跳过开发测试夹具。");
} else {
  const hqId = await seedOrgUnit("ORG-HQ", "自然执法总队", null);
  const deptAId = await seedOrgUnit("ORG-DEPT-A", "第一执法支队", hqId);
  const deptBId = await seedOrgUnit("ORG-DEPT-B", "第二执法支队", hqId);

  const passwordHash = await hash(SEED_PASSWORD);
  await seedPersonnel("P-SUP-A", "甲主管", deptAId, "supervisor", passwordHash, "13800001001");
  await seedPersonnel("P-CLERK-A", "乙经办", deptAId, "clerk", passwordHash, "13800001002");
  await seedPersonnel("P-CLERK-B", "丙经办", deptBId, "clerk", passwordHash, "13800001003");
}

await prisma.$disconnect();
