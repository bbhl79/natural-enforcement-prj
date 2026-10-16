// E2 越权必失败（#96）：操作码 × 身份 / 权限 / 数据范围。
// 「校验拒绝」= 抛 AccessDeniedError 且 reason 精确命中期望码。
// 「校验缺失」= 放行或裸异常。expectDenied 把后者判红。
// 自清理：开跑前从 it_template 复制出 e2_时间戳，断言打在复制品上，结束整库删除。
// 开发库 postgres 不作为复制源。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAuditTrail } from '@natural-enforcement/audit';
import {
  OPCODES,
  effectiveOpcodeRequirements,
  opcodeRequirements,
} from '@natural-enforcement/shield';

import { PrismaClient } from '../backend/prisma/generated/prisma/client.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';
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

const SEED_PASSWORD = 'Seed-pass-52';

/** #71 决议允许行。不从种子源码推导。 */
const ALLOWED: Record<string, readonly string[]> = {
  内勤: ['clue.org.assign', 'clue.handler.assign', 'case.reassign.submit', 'clue.read', 'case.read', 'doc.read'],
  经办: [
    'clue.verify.start', 'case.open', 'doc.draft', 'doc.submit', 'case.reassign.submit',
    'legal.review.request', 'clue.read', 'case.read', 'doc.read', 'clue.export', 'case.export', 'doc.export',
  ],
  法制审核: [
    'legal.opinion.draft', 'legal.opinion.submit', 'clue.read', 'case.read', 'doc.read',
    'clue.export', 'case.export', 'doc.export',
  ],
  行政审核: [
    'legal.review.request', 'doc.admin.review', 'clue.read', 'case.read', 'doc.read',
    'clue.export', 'case.export', 'doc.export',
  ],
  行政审批: [
    'legal.review.request', 'doc.approve', 'clue.read', 'case.read', 'doc.read',
    'clue.export', 'case.export', 'doc.export',
  ],
  监督: [
    'clue.read', 'case.read', 'doc.read', 'clue.export', 'case.export', 'doc.export',
    'audit.admin.read', 'audit.admin.export',
  ],
  系统管理: [
    ...['template', 'rule', 'calendar', 'metric'].flatMap((object) =>
      ['submit', 'approve', 'void', 'withdraw', 'read'].map((action) => `cfg.${object}.${action}`),
    ),
    'personnel.locked.read', 'personnel.locked.release', 'personnel.password.reset',
    'audit.admin.read', 'audit.admin.export', 'authz.binding.submit', 'authz.binding.approve',
  ],
};

let prisma = undefined as unknown as PrismaClient;
let cloned: ClonedDatabase | undefined;
let access: AccessControlService;
let orgUnits: OrgUnitService;
let personnel: PersonnelService;
let credential: CredentialService;

let hqId: string;
let deptAId: string;
let deptBId: string;
let stationAId: string;
let supAId: string;
let clerkAId: string;
let clerkBId: string;
let intakeId: string;
let legalId: string;
let reviewId: string;
let approveId: string;
let superBId: string;
let bothAId: string;

const auth = (personnelId: string): ActorRef => ({ personnelId, authenticated: true });
const uniqueCode = (prefix: string) => `${prefix}-${newUlid().slice(0, 8).toLowerCase()}`;

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

interface DenialRow {
  actor_id: string | null;
  actor_code: string | null;
  opcode: string | null;
  resource_type: string | null;
  resource_id: string | null;
  reason: string | null;
  action: string;
  outcome: string;
  org_unit_id: string | null;
  subject_personnel_id: string | null;
}

async function denialsFor(resourceId: string): Promise<DenialRow[]> {
  return prisma.$queryRaw<DenialRow[]>`
    SELECT actor_id, actor_code, opcode, resource_type, resource_id, reason,
           action, outcome, org_unit_id, subject_personnel_id
    FROM audit_trail
    WHERE resource_id = ${resourceId}
  `;
}

async function grantRole(personnelId: string, roleName: string): Promise<void> {
  const role = await prisma.role.findFirstOrThrow({ where: { name: roleName, deactivatedAt: null } });
  await prisma.personnelRole.create({
    data: { id: newUlid(), personnelId, roleId: role.id },
  });
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  prisma = cloned.prisma;
  const store = new PrismaIdentityStore(prisma);
  const audit = new PrismaAuditTrail(prisma);
  access = new AccessControlService(store, audit);
  credential = new CredentialService(store);
  orgUnits = new OrgUnitService(store, access);
  personnel = new PersonnelService(store, access, credential);

  hqId = (await prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-HQ' } })).id;
  deptAId = (await prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
  deptBId = (await prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-B' } })).id;
  stationAId = (await prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-STATION-A' } })).id;
  supAId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-SUP-A' } })).id;
  clerkAId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-CLERK-A' } })).id;
  clerkBId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-CLERK-B' } })).id;
  intakeId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-INTAKE-HQ' } })).id;
  legalId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-LEGAL-ST' } })).id;
  reviewId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-REVIEW-A' } })).id;
  approveId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-APPROVE-HQ' } })).id;
  superBId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-SUPER-B' } })).id;
  bothAId = (await prisma.personnel.findUniqueOrThrow({ where: { code: 'P-BOTH-A' } })).id;
});

afterAll(async () => {
  await cloned?.close();
});

const personIdByRole: Record<string, () => string> = {
  内勤: () => intakeId,
  经办: () => clerkAId,
  法制审核: () => legalId,
  行政审核: () => reviewId,
  行政审批: () => approveId,
  监督: () => superBId,
  系统管理: () => supAId,
};

const orgIdByRole: Record<string, () => string> = {
  内勤: () => hqId,
  经办: () => deptAId,
  法制审核: () => stationAId,
  行政审核: () => deptAId,
  行政审批: () => hqId,
  监督: () => deptBId,
  系统管理: () => deptAId,
};

describe('操作码授权', () => {
  it('七个角色的种子人员对决议表逐条允许或拒绝', async () => {
    const allowed = new Set(OPCODES);
    for (const [role, codes] of Object.entries(ALLOWED)) {
      const actor = auth(personIdByRole[role]!());
      const target = orgIdByRole[role]!();
      for (const opcode of codes) {
        const context = await access.authorize(actor, opcode, target);
        expect(context.roles, `${role} ${opcode}`).toContain(role);
        allowed.delete(opcode);
      }
      for (const opcode of OPCODES) {
        if (codes.includes(opcode)) continue;
        await expectDenied(access.authorize(actor, opcode, target), 'permission-denied');
      }
    }
    expect(allowed.size).toBe(0);
  }, 120_000);

  it('名册外的操作码得 permission-denied', async () => {
    await expectDenied(access.authorize(auth(clerkAId), 'menu.visible', deptAId), 'permission-denied');
  });

  it('A1：区人员对其他区的阅读操作码得 scope-denied', async () => {
    await expectDenied(access.authorize(auth(clerkAId), 'clue.read', deptBId), 'scope-denied');
  });

  it('放行不写授权拒绝', async () => {
    const resourceId = uniqueCode('allow');
    await access.authorize(auth(clerkAId), 'clue.read', deptAId, { resourceType: 'clue', resourceId });
    expect(await denialsFor(resourceId)).toEqual([]);
  });

  it('拒绝写下操作者、操作码、资源和原因', async () => {
    const resourceId = uniqueCode('deny');
    await expectDenied(
      access.authorize(auth(clerkAId), 'doc.approve', deptAId, { resourceType: 'doc', resourceId }),
      'permission-denied',
    );
    const rows = await denialsFor(resourceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'authz.denied',
      outcome: 'failed',
      actor_id: clerkAId,
      opcode: 'doc.approve',
      resource_type: 'doc',
      resource_id: resourceId,
      reason: 'permission-denied',
      org_unit_id: deptAId,
      subject_personnel_id: null,
    });
  });

  it('未知人员拒绝时操作者为空', async () => {
    const resourceId = uniqueCode('unknown');
    await expectDenied(
      access.authorize(auth(newUlid()), 'clue.read', deptAId, { resourceId }),
      'identity-unknown',
    );
    const rows = await denialsFor(resourceId);
    expect(rows[0]).toMatchObject({
      reason: 'identity-unknown',
      actor_id: null,
      actor_code: null,
      org_unit_id: null,
      opcode: 'clue.read',
    });
  });

  it('未认证先于权限拒绝', async () => {
    await expectDenied(
      access.authorize({ personnelId: clerkAId, authenticated: false }, 'not-an-opcode', deptAId),
      'not-authenticated',
    );
  });

  it('A4：监督即使被挂上 case.open，授权仍得 permission-denied；兼任经办则放行', async () => {
    const supervision = await prisma.role.findFirstOrThrow({ where: { name: '监督', deactivatedAt: null } });
    const permission = await prisma.permission.findFirstOrThrow({
      where: { code: 'case.open', deactivatedAt: null },
    });
    const allowId = newUlid();
    await prisma.rolePermission.create({
      data: { id: allowId, roleId: supervision.id, permissionId: permission.id },
    });
    try {
      await expectDenied(access.authorize(auth(superBId), 'case.open', deptBId), 'permission-denied');
      const context = await access.authorize(auth(bothAId), 'case.open', deptAId);
      expect(context.personnelId).toBe(bothAId);
    } finally {
      await prisma.rolePermission.update({ where: { id: allowId }, data: { deactivatedAt: new Date() } });
    }
  });

  it('case.reassign.submit 与 legal.review.request 按能放行的角色取最宽要求', () => {
    expect(effectiveOpcodeRequirements('case.reassign.submit', ['经办'])?.mustBeCaseHandler).toBe(true);
    expect(effectiveOpcodeRequirements('case.reassign.submit', ['内勤'])?.mustBeCaseHandler).toBe(false);
    expect(effectiveOpcodeRequirements('case.reassign.submit', ['经办', '内勤'])?.mustBeCaseHandler).toBe(false);
    expect(effectiveOpcodeRequirements('legal.review.request', ['经办'])).toMatchObject({
      qualification: 'operator',
      mustBeCaseHandler: true,
    });
    expect(effectiveOpcodeRequirements('legal.review.request', ['行政审核'])).toMatchObject({
      qualification: 'none',
      mustBeCaseHandler: false,
    });
    expect(effectiveOpcodeRequirements('legal.review.request', ['经办', '行政审核'])).toMatchObject({
      qualification: 'none',
      mustBeCaseHandler: false,
    });
  });

  it('A2：执法证过期的经办仍可放行，上下文没有执法资格，名册把启动核查标为查操作的人', async () => {
    const context = await access.authorize(auth(clerkBId), 'clue.verify.start', deptBId);
    expect(context.hasEnforcementQualification).toBe(false);
    expect(JSON.stringify(context)).not.toContain('CERT-EXPIRED-B');
    expect(opcodeRequirements('clue.verify.start')).toMatchObject({
      qualification: 'operator',
      mustBeCaseHandler: true,
    });
    const valid = await access.authorize(auth(clerkAId), 'clue.read', deptAId);
    expect(valid.hasEnforcementQualification).toBe(true);
    expect(JSON.stringify(valid)).not.toContain('CERT-VALID-A');
  });

  it('有效期等于 Asia/Shanghai 的今天仍有资格，UTC 与上海相差一天时按上海', async () => {
    const created = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-cert'),
      name: '资格边界',
      orgUnitId: deptAId,
    });
    await grantRole(created.id, '经办');
    const store = new PrismaIdentityStore(prisma);
    const clocked = new AccessControlService(store, new PrismaAuditTrail(prisma), {
      now: () => new Date('2026-10-16T16:30:00.000Z'),
    });
    await prisma.personnel.update({
      where: { id: created.id },
      data: {
        enforcementCertNo: 'CERT-BOUNDARY',
        enforcementCertExpiresOn: new Date('2026-10-16T00:00:00.000Z'),
      },
    });
    const yesterday = await clocked.authorize(auth(created.id), 'clue.read', deptAId);
    expect(yesterday.hasEnforcementQualification).toBe(false);
    await prisma.personnel.update({
      where: { id: created.id },
      data: { enforcementCertExpiresOn: new Date('2026-10-17T00:00:00.000Z') },
    });
    const sameDay = await clocked.authorize(auth(created.id), 'clue.read', deptAId);
    expect(sameDay.hasEnforcementQualification).toBe(true);
    expect(JSON.stringify(sameDay)).not.toContain('CERT-BOUNDARY');
    const nextDay = new AccessControlService(store, new PrismaAuditTrail(prisma), {
      now: () => new Date('2026-10-17T16:30:00.000Z'),
    });
    const rolled = await nextDay.authorize(auth(created.id), 'clue.read', deptAId);
    expect(rolled.hasEnforcementQualification).toBe(false);
  });

  it('A7：数据范围是当前任职及其下级，不含兄弟机构；没有任职则为空集', async () => {
    const scope = await access.listDataScopeOrgUnitIds(clerkAId);
    expect(new Set(scope)).toEqual(new Set([deptAId, stationAId]));
    expect(scope).not.toContain(deptBId);
    expect(scope).not.toContain(hqId);
    const created = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-noscope'),
      name: '无任职',
      orgUnitId: deptAId,
    });
    await grantRole(created.id, '经办');
    const current = await prisma.personnelAssignment.findFirstOrThrow({
      where: { personnelId: created.id, endedAt: null },
    });
    await prisma.personnelAssignment.update({ where: { id: current.id }, data: { endedAt: new Date() } });
    expect(await access.listDataScopeOrgUnitIds(created.id)).toEqual([]);
    await expectDenied(access.authorize(auth(created.id), 'clue.read', deptAId), 'scope-denied');
  });

  it('改角色后下一次授权使用新角色', async () => {
    const created = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-role'),
      name: '改角色',
      orgUnitId: deptAId,
    });
    await grantRole(created.id, '内勤');
    await expect(access.authorize(auth(created.id), 'clue.org.assign', deptAId)).resolves.toMatchObject({
      personnelId: created.id,
    });
    const binding = await prisma.personnelRole.findFirstOrThrow({
      where: { personnelId: created.id, deactivatedAt: null, role: { name: '内勤' } },
    });
    await prisma.personnelRole.update({ where: { id: binding.id }, data: { deactivatedAt: new Date() } });
    await grantRole(created.id, '法制审核');
    await expectDenied(access.authorize(auth(created.id), 'clue.org.assign', deptAId), 'permission-denied');
    await expect(access.authorize(auth(created.id), 'legal.opinion.draft', deptAId)).resolves.toMatchObject({
      personnelId: created.id,
    });
  });
});

describe('E2 根机构登记', () => {
  it('未认证登记根机构被拒，且不写库', async () => {
    const code = uniqueCode('e2-root-na');
    await expectDenied(
      orgUnits.registerOrgUnit(
        { personnelId: clerkAId, authenticated: false },
        { code, name: '未认证根机构', parentId: null },
      ),
      'not-authenticated',
    );
    expect(await prisma.orgUnit.findUnique({ where: { code } })).toBeNull();
  });

  it('没有维护允许行的人员登记根机构被拒', async () => {
    await expectDenied(
      orgUnits.registerOrgUnit(auth(clerkAId), {
        code: uniqueCode('e2-root-v'),
        name: '经办根机构',
        parentId: null,
      }),
      'permission-denied',
    );
  });

  it('有维护允许行的系统管理登记根机构仍被拒', async () => {
    const code = uniqueCode('e2-root-sup');
    await expectDenied(
      orgUnits.registerOrgUnit(auth(supAId), { code, name: '系统管理根机构', parentId: null }),
      'scope-denied',
    );
    expect(await prisma.orgUnit.findUnique({ where: { code } })).toBeNull();
  });

  it('系统管理在本机构下登记子机构', async () => {
    const created = await orgUnits.registerOrgUnit(auth(supAId), {
      code: uniqueCode('e2-child'),
      name: '支队下属机构',
      parentId: deptAId,
    });
    expect(created.parentId).toBe(deptAId);
  });
});

describe('E2 任职记录库层不变量', () => {
  it('只允许关止一次：改其他列被拒，已关止行不可改，不能并存两条当前任职', async () => {
    const mover = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-guard'),
      name: '任职守卫',
      orgUnitId: deptAId,
    });
    const current = await prisma.personnelAssignment.findFirstOrThrow({
      where: { personnelId: mover.id, endedAt: null },
    });
    await expect(
      prisma.$executeRaw`UPDATE personnel_assignment SET org_unit_id = ${deptBId} WHERE id = ${current.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
    await personnel.transferPersonnel(auth(supAId), mover.id, deptBId);
    const closed = await prisma.personnelAssignment.findFirstOrThrow({
      where: { personnelId: mover.id, endedAt: { not: null } },
    });
    await expect(
      prisma.$executeRaw`UPDATE personnel_assignment SET ended_at = NULL WHERE id = ${closed.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(
      prisma.personnelAssignment.create({
        data: { id: newUlid(), personnelId: mover.id, orgUnitId: deptAId, startedAt: new Date() },
      }),
    ).rejects.toThrow();
  });
});

describe('E2 机构与人员维护', () => {
  it('系统管理改本机构名时追加名称版本', async () => {
    const before = await prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId: deptAId },
      orderBy: { version: 'asc' },
    });
    const newName = `第一执法支队（更名${newUlid().slice(0, 4)}）`;
    await orgUnits.renameOrgUnit(auth(supAId), deptAId, newName);
    const after = await prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId: deptAId },
      orderBy: { version: 'asc' },
    });
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)!.name).toBe(newName);
    expect(after[0]!.name).toBe(before[0]!.name);
    const current = await prisma.orgUnit.findUniqueOrThrow({ where: { id: deptAId } });
    expect(current.name).toBe(newName);
  });

  it('其他区人员改本区机构被拒', async () => {
    await expectDenied(
      orgUnits.renameOrgUnit(auth(clerkBId), deptAId, `越权${newUlid().slice(0, 4)}`),
      'permission-denied',
    );
  });

  it('失效人员改数据被拒', async () => {
    const ghost = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-modsup'),
      name: '改用例系统管理',
      orgUnitId: deptAId,
    });
    await grantRole(ghost.id, '系统管理');
    await personnel.deactivatePersonnel(auth(supAId), ghost.id);
    await expectDenied(
      personnel.renamePersonnel(auth(ghost.id), clerkAId, '失效后改名'),
      'identity-deactivated',
    );
  });

  it('人员名称版本只增不改', async () => {
    const target = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-name'),
      name: '改名前',
      orgUnitId: deptAId,
    });
    await personnel.renamePersonnel(auth(supAId), target.id, '改名后');
    const versions = await prisma.personnelNameVersion.findMany({
      where: { personnelId: target.id },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((row) => [row.version, row.name])).toEqual([
      [1, '改名前'],
      [2, '改名后'],
    ]);
    await expect(
      prisma.$executeRaw`UPDATE personnel_name_version SET name = '篡改' WHERE personnel_id = ${target.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
  });

  it('系统管理导出本机构清单并留下导出留痕', async () => {
    const result = await personnel.exportPersonnel(auth(supAId), deptAId);
    expect(result.personnel.length).toBeGreaterThan(0);
    const audit = await prisma.exportAudit.findUniqueOrThrow({ where: { id: result.audit.id } });
    expect(audit.actorId).toBe(supAId);
    expect(audit.targetOrgUnitId).toBe(deptAId);
    expect(audit.exportedCount).toBe(result.personnel.length);
  });

  it('跨区导出被拒且不写导出留痕', async () => {
    const auditsBefore = await prisma.exportAudit.count();
    await expectDenied(personnel.exportPersonnel(auth(supAId), deptBId), 'scope-denied');
    expect(await prisma.exportAudit.count()).toBe(auditsBefore);
  });

  it('没有维护允许行的人员导出被拒', async () => {
    await expectDenied(personnel.exportPersonnel(auth(clerkAId), deptAId), 'permission-denied');
  });

  it('导出留痕拒绝更新和删除', async () => {
    const result = await personnel.exportPersonnel(auth(supAId), deptAId);
    await expect(
      prisma.$executeRaw`UPDATE export_audit SET exported_count = 0 WHERE id = ${result.audit.id}`,
    ).rejects.toThrow(/拒绝 UPDATE/);
    await expect(
      prisma.$executeRaw`DELETE FROM export_audit WHERE id = ${result.audit.id}`,
    ).rejects.toThrow(/拒绝 DELETE/);
  });

  it('系统管理调岗后任职记录闭环', async () => {
    const mover = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-move'),
      name: '调岗者',
      orgUnitId: deptAId,
    });
    await personnel.transferPersonnel(auth(supAId), mover.id, deptBId);
    const assignments = await prisma.personnelAssignment.findMany({
      where: { personnelId: mover.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0]!.endedAt).not.toBeNull();
    expect(assignments[1]!.orgUnitId).toBe(deptBId);
    expect(assignments[1]!.endedAt).toBeNull();
  });

  it('没有维护允许行的人员不能调岗', async () => {
    const target = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-apr'),
      name: '被调岗者',
      orgUnitId: deptAId,
    });
    await expectDenied(personnel.transferPersonnel(auth(clerkAId), target.id, deptBId), 'permission-denied');
  });

  it('本区系统管理不能调其他区的人', async () => {
    await expectDenied(personnel.transferPersonnel(auth(supAId), clerkBId, deptAId), 'scope-denied');
  });

  it('调岗后下一次授权使用新机构', async () => {
    const mover = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-shift'),
      name: '调岗权限失效者',
      orgUnitId: deptAId,
    });
    await grantRole(mover.id, '经办');
    await expect(access.authorize(auth(mover.id), 'clue.read', deptAId)).resolves.toMatchObject({
      orgUnitId: deptAId,
    });
    await personnel.transferPersonnel(auth(supAId), mover.id, deptBId);
    await expectDenied(access.authorize(auth(mover.id), 'clue.read', deptAId), 'scope-denied');
    await expect(access.authorize(auth(mover.id), 'clue.read', deptBId)).resolves.toMatchObject({
      orgUnitId: deptBId,
    });
    await expectDenied(personnel.transferPersonnel(auth(supAId), mover.id, deptAId), 'scope-denied');
  });

  it('人员失效后行留存，库层拒绝物理删除', async () => {
    const ghost = await personnel.registerPersonnel(auth(supAId), {
      code: uniqueCode('e2-del'),
      name: '失效不删除者',
      orgUnitId: deptAId,
    });
    await personnel.deactivatePersonnel(auth(supAId), ghost.id);
    const row = await prisma.personnel.findUniqueOrThrow({ where: { id: ghost.id } });
    expect(row.deactivatedAt).not.toBeNull();
    await expect(prisma.$executeRaw`DELETE FROM personnel WHERE id = ${ghost.id}`).rejects.toThrow(/拒绝 DELETE/);
  });
});

describe('E2 口令散列', () => {
  it('种子人员口令经 argon2 散列存储，验真通过、错口令拒绝', async () => {
    const row = await prisma.personnel.findUniqueOrThrow({ where: { id: supAId } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(credential.authenticate(supAId, SEED_PASSWORD)).resolves.toBe(true);
    await expect(credential.authenticate(supAId, 'wrong-password')).resolves.toBe(false);
  });
});
