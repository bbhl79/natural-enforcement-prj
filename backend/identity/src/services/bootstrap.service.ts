// 生产引导（#105「生产引导命令（D5）」，#131）：建根机构（层级为市）与首个系统管理人员。
// 没有 HTTP 入口，由 server 镜像里的命令行进程调用（backend/server/src/bootstrap-command.ts）。
// 整条引导一个交互式事务，第一条语句取事务级咨询锁：两个进程并发时只有一次写入，
// 后到的进程等前一个提交后读到两键都在，得到「已引导」。
// 留痕（ADR 0013 第 3 条）：bootstrap.root-registered、bootstrap.admin-registered，所属机构写根机构，
// 与业务行同一事务。口令只以散列进入本服务，不进日志和留痕。

import type { AuditTrailFactory } from '@natural-enforcement/audit';

import {
  BOOTSTRAP_ADMIN_ROLE,
  BootstrapPrerequisiteError,
  judgeBootstrap,
  type BootstrapOutcome,
  type BootstrapProfile,
} from '../domain/bootstrap.ts';
import { ROOT_ORG_UNIT_LEVEL } from '../domain/org-unit.ts';
import { newUlid } from '../domain/ulid.ts';
import type { IdentityStore } from '../persistence/identity-store.ts';

export interface BootstrapRequest extends BootstrapProfile {
  /** 初始口令的散列。口令修改时间留空，首登强制改密。 */
  passwordHash: string;
}

/** 测试接缝②：取到咨询锁之后、读两键之前调用（双连接加屏障的并发用例用）。 */
export interface BootstrapHooks {
  afterLock?: () => Promise<void>;
}

export class BootstrapService {
  constructor(
    private readonly store: IdentityStore,
    private readonly auditFactory: AuditTrailFactory,
  ) {}

  async run(request: BootstrapRequest, hooks: BootstrapHooks = {}): Promise<BootstrapOutcome> {
    return this.store.inTransaction(async (tx) => {
      await tx.store.lockBootstrap();
      await hooks.afterLock?.();

      const root = await tx.store.findOrgUnitByCode(request.rootCode);
      const admin = await tx.store.findPersonnelByCode(request.adminCode);
      const counts = root || admin ? { orgUnits: 0, personnel: 0 } : await tx.store.countOrgUnitsAndPersonnel();
      const judged = judgeBootstrap(request, { root, admin, ...counts });
      if (judged) return judged;

      const roleId = await tx.store.findActiveRoleIdByName(BOOTSTRAP_ADMIN_ROLE);
      if (!roleId) {
        throw new BootstrapPrerequisiteError(
          `参照种子未写入：库里没有未停用的「${BOOTSTRAP_ADMIN_ROLE}」角色。执行顺序：迁移 → 参照种子 → 引导。`,
        );
      }

      const now = new Date();
      const rootId = newUlid();
      await tx.store.insertOrgUnit({
        id: rootId,
        code: request.rootCode,
        name: request.rootName,
        level: ROOT_ORG_UNIT_LEVEL,
        parentId: null,
      });
      await tx.store.insertOrgUnitNameVersion({
        id: newUlid(),
        orgUnitId: rootId,
        name: request.rootName,
        version: 1,
        createdAt: now,
      });

      const adminId = newUlid();
      const inserted = await tx.store.insertPersonnel({
        id: adminId,
        code: request.adminCode,
        name: request.adminName,
        orgUnitId: rootId,
        passwordHash: request.passwordHash,
        mobilePhone: request.adminMobilePhone,
      });
      // 空库上不会撞唯一约束；撞了说明判定之后库被别的路径改过，整体回滚。
      if (inserted.result !== 'written') throw new Error(`首个系统管理人员写入冲突：${inserted.conflict}`);
      await tx.store.insertPersonnelNameVersion({
        id: newUlid(),
        personnelId: adminId,
        name: request.adminName,
        version: 1,
        createdAt: now,
      });
      await tx.store.insertAssignment({
        id: newUlid(),
        personnelId: adminId,
        orgUnitId: rootId,
        startedAt: now,
        endedAt: null,
      });
      const granted = await tx.store.insertPersonnelRole({ id: newUlid(), personnelId: adminId, roleId });
      if (granted.result !== 'written') throw new Error(`首个系统管理人员角色写入冲突：${granted.conflict}`);

      // 操作者、来源地址、操作码、前值空着：命令行进程没有动手的人员，也不经授权（ADR 0011 末条）。
      const audit = this.auditFactory.forClient(tx.client);
      const parties = {
        actorId: null,
        actorCode: null,
        sourceIp: null,
        orgUnitId: rootId,
      };
      await audit.append({
        ...parties,
        action: 'bootstrap.root-registered',
        subjectPersonnelId: null,
        subjectCode: null,
        resourceType: 'org-unit',
        resourceId: rootId,
      });
      await audit.append({
        ...parties,
        action: 'bootstrap.admin-registered',
        subjectPersonnelId: adminId,
        subjectCode: request.adminCode,
        resourceType: 'personnel',
        resourceId: adminId,
      });
      return { result: 'bootstrapped', rootOrgUnitId: rootId, adminPersonnelId: adminId };
    });
  }
}
