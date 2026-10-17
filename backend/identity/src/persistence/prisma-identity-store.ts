// Prisma 适配（#52）：IdentityStore 端口的 backend/prisma 实现，模块内唯一 import
// 生成客户端的文件。仓库内不生成 Prisma Client（产物只存在于容器可写层），
// 故本文件被根 tsconfig 排除在 unit 层类型检查之外，由 integration 层
//（dev test integration：先 prisma generate 再 tsc -p integration）承载其编译。
// 触发器（迁移 0002_identity_org）在库层兜底 append-only/只失效不删除，
// 适配器不提供任何 delete 调用。

import type { Prisma, PrismaClient } from '../../../prisma/generated/prisma/client.ts';

import { isOrgUnitLevel } from '../domain/org-unit.ts';

import type {
  ExportAuditRow,
  IdentityStore,
  OpcodeGrant,
  OrgUnitNameVersionRow,
  OrgUnitRow,
  OrgUnitToCreate,
  AssignmentTransfer,
  IdentityTransaction,
  IdentityUniqueConflict,
  PersonnelAssignmentRow,
  PersonnelRoleToCreate,
  PersonnelNameVersionRow,
  PersonnelRow,
  PersonnelToCreate,
  UniqueWriteResult,
} from './identity-store.ts';

/** Prisma 根客户端，或一个交互式事务客户端（#119）。 */
export type IdentityDb = PrismaClient | Prisma.TransactionClient;

const WRITTEN: UniqueWriteResult = { result: 'written' };

type OrgUnitRecord = {
  id: string;
  code: string;
  name: string;
  level: string;
  parentId: string | null;
  deactivatedAt: Date | null;
};

/** 库行转端口行。层级取值不认识时报错（库层 CHECK 已兜底，这里不静默放过）。 */
function toOrgUnitRow(row: OrgUnitRecord): OrgUnitRow {
  if (!isOrgUnitLevel(row.level)) throw new Error(`机构 ${row.id} 的层级取值不认识：${row.level}`);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    level: row.level,
    parentId: row.parentId,
    deactivatedAt: row.deactivatedAt,
  };
}

/**
 * 同一事务客户端上的受唯一约束写入排队执行（#119）。
 * 保存点、写入、回到保存点、释放必须连成一段，不能与同一事务里的另一笔唯一写入交错，
 * 否则冲突后、回滚前插进来的语句会被 PostgreSQL 以 25P02 拒绝。
 * 按客户端对象排队，绑定同一事务的多个存储实例共享同一队列。
 */
const uniqueQueues = new WeakMap<object, Promise<unknown>>();

function enqueue<T>(client: object, task: () => Promise<T>): Promise<T> {
  const previous = uniqueQueues.get(client) ?? Promise.resolve();
  const next = previous.then(task, task);
  uniqueQueues.set(client, next.catch(() => undefined));
  return next;
}

/** 唯一约束冲突（P2002，即 PostgreSQL 23505）。 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error == null) return false;
  if ('code' in error && String(error.code) === 'P2002') return true;
  const message = 'message' in error ? String(error.message) : '';
  return message.includes('23505') || message.includes('Unique constraint');
}

export class PrismaIdentityStore implements IdentityStore {
  private readonly prisma: IdentityDb;
  private readonly root: PrismaClient | null;

  /** 根客户端：inTransaction 另开交互式事务。 */
  constructor(prisma: PrismaClient);
  /** 交互式事务客户端：全部读写都在该事务里，inTransaction 不另开事务。 */
  constructor(tx: Prisma.TransactionClient, bound: 'transaction');
  constructor(db: IdentityDb, bound?: 'transaction') {
    this.prisma = db;
    this.root = bound === 'transaction' ? null : (db as PrismaClient);
  }

  async inTransaction<T>(work: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    if (!this.root) return work({ store: this, client: this.prisma });
    return this.root.$transaction((client) =>
      work({ store: new PrismaIdentityStore(client, 'transaction'), client }));
  }

  /**
   * 执行一笔受唯一约束的写入。冲突时交给 classify 判定种类，返回 already-exists。
   * 事务里先设保存点，冲突只回到保存点，事务仍可继续。根客户端每条语句自成事务，无需保存点。
   * 同一事务里的唯一写入排队执行（见 enqueue）。同一事务里与其他写入并发仍不受支持。
   */
  private unique(
    write: () => Promise<unknown>,
    classify: () => Promise<IdentityUniqueConflict | null>,
  ): Promise<UniqueWriteResult> {
    if (this.root) return this.uniqueNow(write, classify, false);
    return enqueue(this.prisma, () => this.uniqueNow(write, classify, true));
  }

  private async uniqueNow(
    write: () => Promise<unknown>,
    classify: () => Promise<IdentityUniqueConflict | null>,
    inTx: boolean,
  ): Promise<UniqueWriteResult> {
    if (inTx) await this.prisma.$executeRawUnsafe('SAVEPOINT identity_unique_write');
    try {
      await write();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (inTx) await this.prisma.$executeRawUnsafe('ROLLBACK TO SAVEPOINT identity_unique_write');
      const conflict = await classify();
      if (!conflict) throw error;
      return { result: 'already-exists', conflict };
    }
    if (inTx) await this.prisma.$executeRawUnsafe('RELEASE SAVEPOINT identity_unique_write');
    return WRITTEN;
  }

  findPersonnelById(id: string): Promise<PersonnelRow | null> {
    return this.prisma.personnel.findUnique({ where: { id } });
  }

  async findOrgUnitById(id: string): Promise<OrgUnitRow | null> {
    const row = await this.prisma.orgUnit.findUnique({ where: { id } });
    return row ? toOrgUnitRow(row) : null;
  }

  async findCurrentAssignment(personnelId: string): Promise<PersonnelAssignmentRow | null> {
    const rows = await this.prisma.personnelAssignment.findMany({
      where: { personnelId, endedAt: null },
      orderBy: { startedAt: 'desc' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /** 祖先链（含自身），自根向叶；目标机构不存在时返回空链（调用方按越权处理） */
  async findOrgUnitPathToRoot(orgUnitId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id FROM org_unit WHERE id = ${orgUnitId}
        UNION ALL
        SELECT parent.id, parent.parent_id
        FROM org_unit parent JOIN up child ON parent.id = child.parent_id
      )
      SELECT id FROM up`;
    return rows.map((row) => row.id);
  }

  async listOrgUnitSubtreeIds(orgUnitId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE down AS (
        SELECT id FROM org_unit WHERE id = ${orgUnitId}
        UNION ALL
        SELECT child.id
        FROM org_unit child
        JOIN down parent ON child.parent_id = parent.id
      )
      SELECT id FROM down`;
    return rows.map((row) => row.id);
  }

  async listActiveRoleNames(personnelId: string): Promise<string[]> {
    const rows = await this.prisma.personnelRole.findMany({
      where: { personnelId, deactivatedAt: null, role: { deactivatedAt: null } },
      include: { role: true },
    });
    return rows.map((row) => row.role.name);
  }

  async listGrantingRoleNames(personnelId: string, opcode: string): Promise<string[]> {
    const rows = await this.prisma.personnelRole.findMany({
      where: {
        personnelId,
        deactivatedAt: null,
        role: {
          deactivatedAt: null,
          rolePermissions: {
            some: {
              deactivatedAt: null,
              permission: { code: opcode, deactivatedAt: null },
            },
          },
        },
      },
      include: { role: true },
    });
    return rows.map((row) => row.role.name);
  }

  async listGrantedOpcodes(personnelId: string): Promise<OpcodeGrant[]> {
    const rows = await this.prisma.personnelRole.findMany({
      where: { personnelId, deactivatedAt: null, role: { deactivatedAt: null } },
      include: {
        role: {
          include: {
            rolePermissions: {
              where: { deactivatedAt: null, permission: { deactivatedAt: null } },
              include: { permission: true },
            },
          },
        },
      },
    });
    return rows.flatMap((row) =>
      row.role.rolePermissions.map((grant) => ({ opcode: grant.permission.code, roleName: row.role.name })),
    );
  }

  listOrgUnitNameVersions(orgUnitId: string): Promise<OrgUnitNameVersionRow[]> {
    return this.prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId },
      orderBy: { version: 'asc' },
    });
  }

  async listOrgUnitSubtree(orgUnitId: string): Promise<OrgUnitRow[]> {
    const ids = await this.listOrgUnitSubtreeIds(orgUnitId);
    if (ids.length === 0) return [];
    const rows = await this.prisma.orgUnit.findMany({
      where: { id: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toOrgUnitRow);
  }

  listOrgUnitNameVersionsOf(orgUnitIds: readonly string[]): Promise<OrgUnitNameVersionRow[]> {
    if (orgUnitIds.length === 0) return Promise.resolve([]);
    return this.prisma.orgUnitNameVersion.findMany({
      where: { orgUnitId: { in: [...orgUnitIds] } },
      orderBy: [{ orgUnitId: 'asc' }, { version: 'asc' }],
    });
  }

  async countActivePersonnelByOrgUnit(orgUnitIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (orgUnitIds.length === 0) return counts;
    const rows = await this.prisma.personnelAssignment.groupBy({
      by: ['orgUnitId'],
      where: { orgUnitId: { in: [...orgUnitIds] }, endedAt: null, personnel: { deactivatedAt: null } },
      _count: { _all: true },
    });
    for (const row of rows) counts.set(row.orgUnitId, row._count._all);
    return counts;
  }

  async lockOrgUnit(orgUnitId: string, mode: 'share' | 'update'): Promise<OrgUnitRow | null> {
    const rows = mode === 'update'
      ? await this.prisma.$queryRaw<OrgUnitRecord[]>`
          SELECT id, code, name, level, parent_id AS "parentId", deactivated_at AS "deactivatedAt"
          FROM org_unit WHERE id = ${orgUnitId} FOR UPDATE`
      : await this.prisma.$queryRaw<OrgUnitRecord[]>`
          SELECT id, code, name, level, parent_id AS "parentId", deactivated_at AS "deactivatedAt"
          FROM org_unit WHERE id = ${orgUnitId} FOR SHARE`;
    const row = rows[0];
    return row ? toOrgUnitRow(row) : null;
  }

  listPersonnelNameVersions(personnelId: string): Promise<PersonnelNameVersionRow[]> {
    return this.prisma.personnelNameVersion.findMany({
      where: { personnelId },
      orderBy: { version: 'asc' },
    });
  }

  listActivePersonnelOfOrgUnit(orgUnitId: string): Promise<PersonnelRow[]> {
    return this.prisma.personnel.findMany({
      where: { orgUnitId, deactivatedAt: null },
      orderBy: { code: 'asc' },
    });
  }

  findExportAuditById(id: string): Promise<ExportAuditRow | null> {
    return this.prisma.exportAudit.findUnique({ where: { id } });
  }

  async lockBootstrap(): Promise<void> {
    if (this.root) throw new Error('引导咨询锁须在交互式事务里取得');
    // 事务级咨询锁（#131）。键由固定字符串派生，与其他咨询锁不相撞。
    await this.prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('natural-enforcement:identity:bootstrap', 0))::text AS locked`;
  }

  async findOrgUnitByCode(code: string): Promise<OrgUnitRow | null> {
    const row = await this.prisma.orgUnit.findUnique({ where: { code } });
    return row ? toOrgUnitRow(row) : null;
  }

  findPersonnelByCode(code: string): Promise<PersonnelRow | null> {
    return this.prisma.personnel.findUnique({ where: { code } });
  }

  async countOrgUnitsAndPersonnel(): Promise<{ orgUnits: number; personnel: number }> {
    const orgUnits = await this.prisma.orgUnit.count();
    const personnel = await this.prisma.personnel.count();
    return { orgUnits, personnel };
  }

  async findActiveRoleIdByName(name: string): Promise<string | null> {
    const row = await this.prisma.role.findFirst({ where: { name, deactivatedAt: null }, orderBy: { id: 'asc' } });
    return row?.id ?? null;
  }

  async insertOrgUnit(input: OrgUnitToCreate): Promise<void> {
    await this.prisma.orgUnit.create({ data: input });
  }

  async insertOrgUnitNameVersion(row: OrgUnitNameVersionRow): Promise<void> {
    await this.prisma.orgUnitNameVersion.create({ data: row });
  }

  async updateOrgUnitCurrentName(orgUnitId: string, name: string): Promise<void> {
    await this.prisma.orgUnit.update({ where: { id: orgUnitId }, data: { name } });
  }

  async deactivateOrgUnit(orgUnitId: string, deactivatedAt: Date): Promise<void> {
    await this.prisma.orgUnit.update({ where: { id: orgUnitId }, data: { deactivatedAt } });
  }

  insertPersonnel(input: PersonnelToCreate): Promise<UniqueWriteResult> {
    return this.unique(
      () => this.prisma.personnel.create({ data: input }),
      async () => {
        if (await this.prisma.personnel.findUnique({ where: { code: input.code } })) return 'personnel-code';
        if (input.mobilePhone && await this.prisma.personnel.findUnique({
          where: { mobilePhone: input.mobilePhone },
        })) return 'mobile-phone';
        return null;
      },
    );
  }

  updatePersonnelMobilePhone(personnelId: string, mobilePhone: string | null): Promise<UniqueWriteResult> {
    return this.unique(
      () => this.prisma.personnel.update({ where: { id: personnelId }, data: { mobilePhone } }),
      async () => 'mobile-phone',
    );
  }

  insertPersonnelRole(row: PersonnelRoleToCreate): Promise<UniqueWriteResult> {
    return this.unique(
      () => this.prisma.personnelRole.create({ data: row }),
      async () => {
        const active = await this.prisma.personnelRole.findFirst({
          where: { personnelId: row.personnelId, roleId: row.roleId, deactivatedAt: null },
        });
        return active ? 'personnel-role' : null;
      },
    );
  }

  async insertPersonnelNameVersion(row: PersonnelNameVersionRow): Promise<void> {
    await this.prisma.personnelNameVersion.create({ data: row });
  }

  async updatePersonnelCurrentName(personnelId: string, name: string): Promise<void> {
    await this.prisma.personnel.update({ where: { id: personnelId }, data: { name } });
  }

  async updatePersonnelOrgUnit(personnelId: string, orgUnitId: string): Promise<void> {
    await this.prisma.personnel.update({ where: { id: personnelId }, data: { orgUnitId } });
  }

  async deactivatePersonnel(personnelId: string, deactivatedAt: Date): Promise<void> {
    await this.prisma.personnel.update({ where: { id: personnelId }, data: { deactivatedAt } });
  }

  async replacePasswordHash(
    personnelId: string,
    expectedHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.personnel.updateMany({
      where: { id: personnelId, passwordHash: expectedHash },
      data: { passwordHash },
    });
    return result.count === 1;
  }

  async changePassword(
    personnelId: string,
    passwordHash: string,
    passwordChangedAt: Date,
  ): Promise<void> {
    await this.prisma.personnel.update({
      where: { id: personnelId },
      data: { passwordHash, passwordChangedAt },
    });
  }

  async insertAssignment(row: PersonnelAssignmentRow): Promise<void> {
    await this.prisma.personnelAssignment.create({ data: row });
  }

  async closeAssignment(assignmentId: string, endedAt: Date): Promise<void> {
    await this.prisma.personnelAssignment.update({
      where: { id: assignmentId },
      data: { endedAt },
    });
  }

  async transferAssignment(transfer: AssignmentTransfer): Promise<void> {
    // 交互式事务（#119）。已绑定事务时并入当前事务，与调用方的留痕同成同败。
    // 顺序固定：先关止旧任职，部分唯一索引才允许插入新的当前任职。
    await this.inTransaction(async ({ client }) => {
      const tx = client as Prisma.TransactionClient;
      await tx.personnelAssignment.update({
        where: { id: transfer.closedAssignmentId },
        data: { endedAt: transfer.endedAt },
      });
      await tx.personnelAssignment.create({ data: transfer.next });
      await tx.personnel.update({
        where: { id: transfer.personnelId },
        data: { orgUnitId: transfer.toOrgUnitId },
      });
    });
  }

}
