// E2 越权必失败矩阵（#52）：读 / 改 / 导出 / 审批 × 身份 / 权限 / 数据范围。
// 红绿对照的区分载体（#47 Testing Decisions）：
//   「校验拒绝」= 抛 AccessDeniedError 且 reason 精确命中期望码；
//   「校验缺失」= 调用未抛 AccessDeniedError（越权放行或裸异常）——expectDenied 显式判红。
// 数据层证据同卷给出：名称版本化（版本行 append-only）、只失效不删除（行留存 + 触发器拒删）、
// 导出留痕不可删改（触发器拒 UPDATE/DELETE）、调岗后旧权限失效（任职记录闭环）。
// 用例经服务层驱动（模块内设施），直连库仅用于：读种子参考数据、验证触发器兜底。
import { beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';
import {
  AccessControlService,
  CredentialService,
  OrgUnitService,
  PersonnelService,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
} from '../backend/identity/src/index.ts';
import { PrismaIdentityStore } from '../backend/identity/src/persistence/prisma-identity-store.ts';

const SEED_PASSWORD = "Seed-pass-52"; // 与 backend/prisma/seed.mjs 的种子口令约定一致

let prisma: PrismaClient;
let orgUnits: OrgUnitService;
let personnel: PersonnelService;
let credential: CredentialService;

let deptAId: string;
let deptBId: string;
let supAId: string;
let clerkAId: string;
let clerkBId: string;

/** 已认证 actor；未认证用例显式构造 authenticated: false */
const auth = (personnelId: string): ActorRef => ({ personnelId, authenticated: true });

/** 每次运行唯一的业务 code（用例只增不改，重跑不撞唯一约束） */
const uniqueCode = (prefix: string) => `${prefix}-${newUlid().slice(0, 8).toLowerCase()}`;

/** 「校验拒绝」断言：必须是 AccessDeniedError 且 reason 命中；放行/裸异常按「校验缺失」判红 */
async function expectDenied(promise: Promise<unknown>, reason: DenyReason): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isAccessDenied(error)) {
      throw new Error(
        `校验缺失形态：抛出的是裸异常而非 AccessDeniedError（期望 reason=${reason}）：${String(error)}`,
      );
    }
    expect(error.reason).toBe(reason);
    return;
  }
  throw new Error(`校验缺失形态：越权调用未抛 AccessDeniedError（期望 reason=${reason}）——校验缺失=放行`);
}

beforeAll(async () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  prisma = new PrismaClient({ adapter });
  const store = new PrismaIdentityStore(prisma);
  const access = new AccessControlService(store);
  credential = new CredentialService(store);
  orgUnits = new OrgUnitService(store, access);
  personnel = new PersonnelService(store, access, credential);

  const deptA = await prisma.orgUnit.findUniqueOrThrow({ where: { code: "ORG-DEPT-A" } });
  const deptB = await prisma.orgUnit.findUniqueOrThrow({ where: { code: "ORG-DEPT-B" } });
  deptAId = deptA.id;
  deptBId = deptB.id;
  supAId = (await prisma.personnel.findUniqueOrThrow({ where: { code: "P-SUP-A" } })).id;
  clerkAId = (await prisma.personnel.findUniqueOrThrow({ where: { code: "P-CLERK-A" } })).id;
  clerkBId = (await prisma.personnel.findUniqueOrThrow({ where: { code: "P-CLERK-B" } })).id;
});

describe('E2 越权必失败矩阵：读（read × 身份/权限/数据范围）', () => {
  it('绿：本支队经办读本支队人员，通过', async () => {
    const detail = await personnel.getPersonnel(auth(clerkAId), clerkAId);
    expect(detail.code).toBe("P-CLERK-A");
    expect(detail.currentOrgUnitId).toBe(deptAId);
  });

  it('红·数据范围：A 部门人员读 B 部门数据必须被拒（scope-denied）', async () => {
    await expectDenied(personnel.getPersonnel(auth(clerkAId), clerkBId), "scope-denied");
  });

  it('红·身份（未认证）：未认证 actor 读数据被拒（not-authenticated）', async () => {
    await expectDenied(
      personnel.getPersonnel({ personnelId: clerkAId, authenticated: false }, clerkAId),
      "not-authenticated",
    );
  });

  it('红·身份（已失效）：失效人员读数据被拒（identity-deactivated），且行留存不失效不删除', async () => {
    const created = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-read"),
      name: "读用例经办",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await personnel.deactivatePersonnel(auth(supAId), created.id);
    await expectDenied(personnel.getPersonnel(auth(created.id), created.id), "identity-deactivated");
    const row = await prisma.personnel.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.deactivatedAt).not.toBeNull();
  });

  it('红·身份（不存在）：未知人员 id 被拒（identity-unknown）', async () => {
    await expectDenied(personnel.getPersonnel(auth(newUlid()), clerkAId), "identity-unknown");
  });

  it('红·权限：viewer 无读以外动作——读仍放行，读权限本身不越界（绿对照）', async () => {
    const viewer = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-viewer"),
      name: "只读查看员",
      orgUnitId: deptAId,
      role: "viewer",
    });
    const detail = await personnel.getPersonnel(auth(viewer.id), clerkAId);
    expect(detail.code).toBe("P-CLERK-A");
  });
});

describe('E2 越权必失败矩阵：改（modify × 身份/权限/数据范围）', () => {
  it('绿：本支队主管改本支队机构名（名称版本化：产生新版本行）', async () => {
    const before = await prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId: deptAId },
      orderBy: { version: "asc" },
    });
    const newName = `第一执法支队（更名${newUlid().slice(0, 4)}）`;
    await orgUnits.renameOrgUnit(auth(supAId), deptAId, newName);
    const after = await prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId: deptAId },
      orderBy: { version: "asc" },
    });
    // 数据层证据：历史版本可查且只增不改——v1 名称原样留存，新版本行追加
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)!.name).toBe(newName);
    expect(after[0].name).toBe(before[0].name);
    const current = await prisma.orgUnit.findUniqueOrThrow({ where: { id: deptAId } });
    expect(current.name).toBe(newName);
  });

  it('红·数据范围：B 部门人员改 A 部门数据被拒（scope-denied）', async () => {
    const newName = `第一执法支队（越权${newUlid().slice(0, 4)}）`;
    await expectDenied(orgUnits.renameOrgUnit(auth(clerkBId), deptAId, newName), "scope-denied");
  });

  it('红·权限：viewer 无改动作（permission-denied）', async () => {
    const viewer = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-mod"),
      name: "改用例查看员",
      orgUnitId: deptAId,
      role: "viewer",
    });
    await expectDenied(
      personnel.renamePersonnel(auth(viewer.id), clerkAId, "越权改名"),
      "permission-denied",
    );
  });

  it('红·身份（已失效）：失效主管改数据被拒（identity-deactivated）', async () => {
    const ghost = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-modsup"),
      name: "改用例主管",
      orgUnitId: deptAId,
      role: "supervisor",
    });
    await personnel.deactivatePersonnel(auth(supAId), ghost.id);
    await expectDenied(
      personnel.renamePersonnel(auth(ghost.id), clerkAId, "失效后改名"),
      "identity-deactivated",
    );
  });

  it('数据层证据：人员名称版本化，v1 历史不可改（触发器拒 UPDATE）', async () => {
    const target = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-name"),
      name: "改名前",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await personnel.renamePersonnel(auth(supAId), target.id, "改名后");
    const versions = await prisma.personnelNameVersion.findMany({
      where: { personnelId: target.id },
      orderBy: { version: "asc" },
    });
    expect(versions.map((v) => [v.version, v.name])).toEqual([
      [1, "改名前"],
      [2, "改名后"],
    ]);
    await expect(
      prisma.$executeRaw`UPDATE personnel_name_version SET name = '篡改' WHERE personnel_id = ${target.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
  });
});

describe('E2 越权必失败矩阵：导出（export × 身份/权限/数据范围）', () => {
  it('绿：本支队经办导出本支队清单，留痕记录产生（谁/何时/什么范围/多少行）', async () => {
    const result = await personnel.exportPersonnel(auth(clerkAId), deptAId);
    expect(result.personnel.length).toBeGreaterThan(0);
    const audit = await prisma.exportAudit.findUniqueOrThrow({ where: { id: result.audit.id } });
    expect(audit.actorId).toBe(clerkAId);
    expect(audit.targetOrgUnitId).toBe(deptAId);
    expect(audit.exportedCount).toBe(result.personnel.length);
  });

  it('红·数据范围：A 部门人员导出 B 部门数据被拒（scope-denied）且不留痕', async () => {
    const auditsBefore = await prisma.exportAudit.count();
    await expectDenied(personnel.exportPersonnel(auth(clerkAId), deptBId), "scope-denied");
    expect(await prisma.exportAudit.count()).toBe(auditsBefore);
  });

  it('红·权限：viewer 无导出动作（permission-denied）', async () => {
    const viewer = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-exp"),
      name: "导出用例查看员",
      orgUnitId: deptAId,
      role: "viewer",
    });
    await expectDenied(personnel.exportPersonnel(auth(viewer.id), deptAId), "permission-denied");
  });

  it('红·身份（已失效）：失效人员导出被拒（identity-deactivated）', async () => {
    const ghost = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-expg"),
      name: "导出用例经办",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await personnel.deactivatePersonnel(auth(supAId), ghost.id);
    await expectDenied(personnel.exportPersonnel(auth(ghost.id), deptAId), "identity-deactivated");
  });

  it('数据层证据：留痕产生后不可删改——触发器拒 UPDATE 与 DELETE', async () => {
    const result = await personnel.exportPersonnel(auth(clerkAId), deptAId);
    await expect(
      prisma.$executeRaw`UPDATE export_audit SET exported_count = 0 WHERE id = ${result.audit.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(
      prisma.$executeRaw`DELETE FROM export_audit WHERE id = ${result.audit.id}`,
    ).rejects.toThrow(/拒绝 DELETE/);
    const audit = await prisma.exportAudit.findUniqueOrThrow({ where: { id: result.audit.id } });
    expect(audit.exportedCount).toBe(result.audit.exportedCount);
  });
});

describe('E2 越权必失败矩阵：审批（approve，调岗 × 身份/权限/数据范围）', () => {
  it('绿：本支队主管审批调岗（approve 动作），任职记录闭环', async () => {
    const mover = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-move"),
      name: "调岗者",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await personnel.transferPersonnel(auth(supAId), mover.id, deptBId);
    const assignments = await prisma.personnelAssignment.findMany({
      where: { personnelId: mover.id },
      orderBy: { startedAt: "asc" },
    });
    expect(assignments.length).toBe(2);
    expect(assignments[0].endedAt).not.toBeNull();
    expect(assignments[1].orgUnitId).toBe(deptBId);
    expect(assignments[1].endedAt).toBeNull();
  });

  it('红·权限：经办无审批权（clerk 调岗 permission-denied）', async () => {
    const target = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-apr"),
      name: "被调岗者",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await expectDenied(
      personnel.transferPersonnel(auth(clerkAId), target.id, deptBId),
      "permission-denied",
    );
  });

  it('红·数据范围：A 部门主管对 B 部门人员发起调岗被拒（scope-denied）', async () => {
    await expectDenied(
      personnel.transferPersonnel(auth(supAId), clerkBId, deptAId),
      "scope-denied",
    );
  });

  it('红·身份（已失效）：失效主管审批被拒（identity-deactivated）', async () => {
    const ghost = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-aprg"),
      name: "审批用例主管",
      orgUnitId: deptAId,
      role: "supervisor",
    });
    const target = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-aprt"),
      name: "审批用例经办",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await personnel.deactivatePersonnel(auth(supAId), ghost.id);
    await expectDenied(
      personnel.transferPersonnel(auth(ghost.id), target.id, deptBId),
      "identity-deactivated",
    );
  });
});

describe('E2 必含用例：调岗后旧权限失效', () => {
  it('调岗即刻生效：旧部门数据不可读、新部门数据可读、原主管不再管辖', async () => {
    const mover = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-shift"),
      name: "调岗权限失效者",
      orgUnitId: deptAId,
      role: "clerk",
    });
    // 调岗前：读本部门绿
    await expect((await personnel.getPersonnel(auth(mover.id), clerkAId)).code).toBe("P-CLERK-A");
    await personnel.transferPersonnel(auth(supAId), mover.id, deptBId);
    // 调岗后：旧部门数据读被拒（旧权限失效）
    await expectDenied(personnel.getPersonnel(auth(mover.id), clerkAId), "scope-denied");
    // 调岗后：新部门数据读放行
    await expect((await personnel.getPersonnel(auth(mover.id), clerkBId)).code).toBe("P-CLERK-B");
    // 原主管对调岗后人员发起调岗：现属 B 不在 A 主管数据范围，被拒
    await expectDenied(
      personnel.transferPersonnel(auth(supAId), mover.id, deptAId),
      "scope-denied",
    );
  });
});

describe('E2 必含用例：只失效不删除（数据层证据）', () => {
  it('人员失效后行留存（deactivated_at 置位），库层触发器拒物理删除', async () => {
    const ghost = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode("e2-del"),
      name: "失效不删除者",
      orgUnitId: deptAId,
      role: "clerk",
    });
    await personnel.deactivatePersonnel(auth(supAId), ghost.id);
    const row = await prisma.personnel.findUniqueOrThrow({ where: { id: ghost.id } });
    expect(row.deactivatedAt).not.toBeNull();
    await expect(
      prisma.$executeRaw`DELETE FROM personnel WHERE id = ${ghost.id}`,
    ).rejects.toThrow(/拒绝 DELETE/);
    await expect(
      prisma.personnel.findUniqueOrThrow({ where: { id: ghost.id } }),
    ).resolves.toBeDefined();
  });
});

describe('E2 附带证据：口令散列与认证（argon2 0.45.1）', () => {
  it('种子人员口令经 argon2 散列存储，验真通过、错口令拒绝', async () => {
    const row = await prisma.personnel.findUniqueOrThrow({ where: { id: supAId } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(credential.authenticate(supAId, SEED_PASSWORD)).resolves.toBe(true);
    await expect(credential.authenticate(supAId, "wrong-password")).resolves.toBe(false);
  });
});
