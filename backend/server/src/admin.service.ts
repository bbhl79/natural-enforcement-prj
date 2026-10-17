import { Inject, Injectable } from '@nestjs/common';
import { rejected, type Rejected } from '@natural-enforcement/audit';
import {
  AccessControlService,
  CredentialService,
  PersonnelService,
  isAccessDenied,
  rejectedPasswordRules,
  type ActorRef,
  type DenyReason,
  type PasswordRuleCode,
  type PersonnelExportItem,
} from '@natural-enforcement/identity';

import { AuthService } from './auth.service.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';

const LOCKED_READ = 'personnel.locked.read';
const LOCKED_RELEASE = 'personnel.locked.release';
const PASSWORD_RESET = 'personnel.password.reset';

export type AdminDenial = { status: 403; body: { reason: DenyReason } };
type NotFound = { status: 404; body: { result: 'not-found' } };
/** 动作的前置判断：通过则交出目标人员，否则是要直接返回的结果。 */
type Guarded = { target: LoginAccount } | NotFound | AdminDenial | Rejected<AdminDenial>;

export type ResetOutcome =
  | { status: 200; body: { result: 'reset' } }
  | { status: 400; body: { result: 'non-compliant'; rules: PasswordRuleCode[] } }
  | { status: 404; body: { result: 'not-found' } }
  | AdminDenial;

export type UnlockOutcome =
  | { status: 200; body: { result: 'unlocked' } }
  | { status: 404; body: { result: 'not-found' } }
  | AdminDenial;

export type PersonnelExportOutcome =
  | {
      status: 200;
      body: { result: 'exported'; orgUnitId: string; itemCount: number; personnel: PersonnelExportItem[] };
    }
  | AdminDenial;

export type LockedListOutcome = {
  status: number;
  body:
    | {
        result: 'listed';
        personnel: Array<{
          id: string;
          code: string;
          name: string;
          orgName: string | null;
          lockedUntil: string;
        }>;
      }
    | { reason: DenyReason };
};

/**
 * A10 管理动作：被锁列表、解锁、重设初始口令（含结束会话与记住我）。
 * 每个写动作在一个交互式事务里完成，业务行与留痕同成同败（#119）。
 * 被拒绝的动作经 rejected(...) 回滚，拒绝留痕在回滚后另起事务写入。
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
    private readonly credentials: CredentialService,
    private readonly personnel: PersonnelService,
    private readonly auth: AuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listLocked(actor: ActorRef): Promise<LockedListOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    try {
      await this.access.authorize(actor, LOCKED_READ, account?.orgUnitId ?? '');
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const scope = new Set(await this.access.listDataScopeOrgUnitIds(actor.personnelId));
    const atRoot = account?.orgUnitId != null && await this.directory.isRootOrg(account.orgUnitId);
    const rows = await this.directory.listLocked(this.clock.now());
    const personnel = rows
      .filter((row) => (row.orgUnitId == null ? atRoot : scope.has(row.orgUnitId)))
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        orgName: row.orgName,
        lockedUntil: row.lockedUntil.toISOString(),
      }));
    return { status: 200, body: { result: 'listed', personnel } };
  }

  async unlock(actor: ActorRef, personnelId: string, sourceIp: string | null): Promise<UnlockOutcome> {
    return this.uow.run<UnlockOutcome>(async (tx) => {
      const guarded = await this.guard(tx, actor, LOCKED_RELEASE, personnelId);
      if (!('target' in guarded)) return guarded;
      const { target } = guarded;
      const admin = await tx.directory.findById(actor.personnelId);
      await tx.directory.clearFailure(target.id);
      await tx.audit.append({
        action: 'account.unlocked',
        actorId: actor.personnelId,
        actorCode: admin?.code ?? null,
        subjectPersonnelId: target.id,
        subjectCode: target.code,
        orgUnitId: target.orgUnitId,
        sourceIp,
      });
      return { status: 200, body: { result: 'unlocked' } };
    });
  }

  async resetPassword(
    actor: ActorRef,
    personnelId: string,
    password: string,
    sourceIp: string | null,
  ): Promise<ResetOutcome> {
    // 第一步：判断能否重设。口令不合规时直接返回，不散列。
    const checked = await this.uow.run<ResetOutcome | { ready: true }>(async (tx) => {
      const guarded = await this.guard(tx, actor, PASSWORD_RESET, personnelId);
      if (!('target' in guarded)) return guarded;
      const rules = rejectedPasswordRules({ password, personnelCode: guarded.target.code });
      if (rules.length > 0) return { status: 400, body: { result: 'non-compliant', rules } };
      return { ready: true };
    });
    if (!('ready' in checked)) return checked;
    // 口令散列在事务之外计算（#119）。
    const passwordHash = await this.credentials.hashPassword(password);
    // 第二步：重设、解除锁定、结束会话和记住我，与各自的留痕同一事务。
    return this.uow.run<ResetOutcome>(async (tx) => {
      const guarded = await this.guard(tx, actor, PASSWORD_RESET, personnelId);
      if (!('target' in guarded)) return guarded;
      const { target } = guarded;
      const now = this.clock.now();
      const wasLocked = target.lockedUntil != null && now.getTime() < target.lockedUntil.getTime();
      const admin = await tx.directory.findById(actor.personnelId);
      await tx.directory.applyInitialPassword(target.id, passwordHash);
      const parties = {
        actorId: actor.personnelId,
        actorCode: admin?.code ?? null,
        subjectPersonnelId: target.id,
        subjectCode: target.code,
        orgUnitId: target.orgUnitId,
        sourceIp,
      };
      await tx.audit.append({ action: 'account.password-reset', ...parties });
      if (wasLocked) await tx.audit.append({ action: 'account.unlocked', ...parties });
      await this.auth.endPersonnelSessions({
        personnelId: target.id,
        actorId: actor.personnelId,
        actorCode: admin?.code ?? '',
        sourceIp,
      }, tx);
      await tx.remember.endActiveForPersonnel(target.id, now, 'admin-ended');
      return { status: 200, body: { result: 'reset' } };
    });
  }

  /**
   * 人员导出（#125，ADR 0013）：读取与留痕同一事务，先写 personnel.exported，写成功才返回数据。
   * 留痕写入失败时整体回滚，请求失败，不返回数据。
   * 被拒时回滚，authz.denied 在回滚后另起事务写入。
   */
  async exportPersonnel(
    actor: ActorRef,
    orgUnitId: string,
    sourceIp: string | null,
  ): Promise<PersonnelExportOutcome> {
    return this.uow.run<PersonnelExportOutcome>(async (tx) => {
      try {
        const personnel = await this.personnel.exportPersonnel(actor, orgUnitId, tx, tx.audit, sourceIp);
        return {
          status: 200,
          body: { result: 'exported', orgUnitId, itemCount: personnel.length, personnel },
        };
      } catch (error) {
        if (isAccessDenied(error) && error.denial) {
          return rejected<PersonnelExportOutcome>({ status: 403, body: { reason: error.reason } }, error.denial);
        }
        throw error;
      }
    });
  }

  /**
   * 目标存在 → 按操作码和数据范围判断 → 目标不是本人。
   * 拒绝时交出 rejected(...)，authz.denied 在业务事务回滚后写入。
   */
  private async guard(
    tx: TxScope,
    actor: ActorRef,
    opcode: string,
    personnelId: string,
  ): Promise<Guarded> {
    const target = await tx.directory.findById(personnelId);
    if (!target) return { status: 404, body: { result: 'not-found' } };
    const targetOrg = target.orgUnitId ?? await tx.directory.rootOrgId();
    if (!targetOrg) return { status: 403, body: { reason: 'scope-denied' } };
    // 授权读取经 tx.store，复用本事务连接（#119）。
    const decision = await this.access.check(actor, opcode, targetOrg, {
      resourceType: 'personnel',
      resourceId: target.id,
    }, tx.store);
    if (!decision.allowed) {
      return rejected<AdminDenial>({ status: 403, body: { reason: decision.reason } }, decision.denial);
    }
    if (target.id === actor.personnelId) return this.denySelf(tx, actor, opcode, target.id, targetOrg);
    return { target };
  }

  private async denySelf(
    tx: TxScope,
    actor: ActorRef,
    opcode: string,
    targetId: string,
    targetOrg: string,
  ): Promise<Rejected<AdminDenial>> {
    const admin = await tx.directory.findById(actor.personnelId);
    return rejected<AdminDenial>({ status: 403, body: { reason: 'permission-denied' } }, {
      action: 'authz.denied',
      outcome: 'failed',
      actorId: actor.personnelId,
      actorCode: admin?.code ?? null,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: admin?.orgUnitId ?? null,
      sourceIp: null,
      reason: 'permission-denied',
      opcode,
      resourceType: 'personnel',
      resourceId: targetId,
      previousValue: null,
      // 对象就是本人，目标机构取对象机构（#105；ADR 0011 修正）。
      targetOrgUnitId: targetOrg,
      targetOrgUnitBasis: 'object',
    });
  }
}
