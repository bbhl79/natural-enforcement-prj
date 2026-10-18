import { Inject, Injectable } from '@nestjs/common';
import { rejected, type AuditEntry, type Rejected } from '@natural-enforcement/audit';
import {
  CredentialService,
  PersonnelProfileService,
  isAccessDenied,
  DEACTIVATED_EDIT_MESSAGE,
  DEACTIVATED_TRANSFER_MESSAGE,
  PERSONNEL_DEACTIVATED_REASON,
  RESTORE_INVALID_MESSAGE,
  ROOT_GUARD_MESSAGE,
  ROOT_GUARD_REASON,
  type ActorRef,
  type CertStatus,
  type DenyReason,
  type PersonnelPost,
  type RegisterPersonnelProfileInput,
  type RegisterRuleCode,
  type RestoreInvalidReason,
  type RestorePersonnelProfileInput,
  type RestoreRuleCode,
  type TransferRuleCode,
  type UpdatePersonnelProfileInput,
  type UpdateRuleCode,
} from '@natural-enforcement/identity';

import { AuthService } from './auth.service.ts';
import { CLOCK, type Clock } from './clock.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

type Denial = { status: 403; body: { reason: DenyReason } };
type NonCompliant = { status: 400; body: { result: 'non-compliant'; rules: RegisterRuleCode[] } };

/** 人员列表的一行（接口形状）。不含手机号和执法证号。 */
export interface PersonnelListView {
  id: string;
  code: string;
  name: string;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
  certStatus: CertStatus;
  deactivatedAt: string | null;
}

export type PersonnelListOutcome =
  | {
    status: 200;
    body: {
      result: 'listed';
      rootId: string;
      orgUnits: Array<{ id: string; name: string; parentId: string | null; deactivatedAt: string | null }>;
      personnel: PersonnelListView[];
    };
  }
  | Denial;

/** 人员卡片（接口形状）。手机号完整返回，界面默认遮挡。 */
export interface PersonnelCardView {
  id: string;
  code: string;
  name: string;
  mobilePhone: string | null;
  orgUnitId: string | null;
  orgName: string | null;
  orgParentName: string | null;
  /** 当前任职机构已停用（#130）：恢复时必须在同一步选一个新的任职机构。 */
  orgDeactivated: boolean;
  roles: string[];
  posts: PersonnelPost[];
  passwordChangedAt: string | null;
  deactivatedAt: string | null;
  cert: { no: string | null; expiresOn: string | null; status: CertStatus };
}

export type PersonnelCardOutcome =
  | { status: 200; body: { result: 'viewed'; personnel: PersonnelCardView } }
  | { status: 404; body: { result: 'not-found' } }
  | Denial;

export type RegisterPersonnelOutcome =
  | { status: 200; body: { result: 'registered'; personnel: { id: string; code: string; name: string; orgUnitId: string } } }
  | NonCompliant
  | { status: 409; body: { result: 'invalid-state' } }
  | { status: 409; body: { result: 'already-exists'; conflict: 'personnel-code' | 'mobile-phone' } }
  | Denial;

/** 编辑（#129）。什么都没改也是 updated：重复授予或摘除返回 200，不写留痕（#105:219、:223）。 */
export type EditPersonnelOutcome =
  | { status: 200; body: { result: 'updated' } }
  | { status: 400; body: { result: 'non-compliant'; rules: UpdateRuleCode[] } }
  | { status: 404; body: { result: 'not-found' } }
  | { status: 409; body: { result: 'already-exists'; conflict: 'mobile-phone' } }
  | InvalidState
  | Denial;

/** 调岗（#129）。unchanged = 目的地就是当前任职机构，200，不写行、不写留痕。 */
export type TransferPersonnelOutcome =
  | { status: 200; body: { result: 'transferred'; orgUnitId: string } }
  | { status: 200; body: { result: 'unchanged' } }
  | { status: 400; body: { result: 'non-compliant'; rules: TransferRuleCode[] } }
  | { status: 404; body: { result: 'not-found' } }
  | InvalidState
  | Denial;

/** 409 invalid-state：码＋一句原因（#105 错误码表）。细分原因另带 reason（根机构守卫 ADR 0014；#130 的三条）。 */
type InvalidStateReason = typeof ROOT_GUARD_REASON | typeof PERSONNEL_DEACTIVATED_REASON | RestoreInvalidReason;

type InvalidState =
  | { status: 409; body: { result: 'invalid-state'; message: string } }
  | { status: 409; body: { result: 'invalid-state'; reason: InvalidStateReason; message: string } };

/**
 * 停用（#130）。重复停用同样返回 deactivated：200，不写行、不写留痕，不改首次停用时间（照机构停用，#124）。
 */
export type DeactivatePersonnelOutcome =
  | { status: 200; body: { result: 'deactivated' } }
  | { status: 404; body: { result: 'not-found' } }
  | InvalidState
  | Denial;

/**
 * 恢复（#130）。orgUnitId 是恢复后的当前任职机构；带新任职机构时恢复与调岗同事务完成。
 * 口令不合规是 400，不写留痕；口令历史比对留给口令历史票（#132）。
 */
export type RestorePersonnelOutcome =
  | { status: 200; body: { result: 'restored'; orgUnitId: string | null } }
  | { status: 400; body: { result: 'non-compliant'; rules: RestoreRuleCode[] } }
  | { status: 404; body: { result: 'not-found' } }
  | InvalidState
  | Denial;

/** 结束全部会话（#130）：每段写 session.ended，另写一行 personnel.sessions-ended，不改口令。 */
export type EndSessionsOutcome =
  | { status: 200; body: { result: 'ended' } }
  | { status: 404; body: { result: 'not-found' } }
  | Denial;

export type TransferDestinationsOutcome =
  | { status: 200; body: { result: 'listed'; orgUnits: Array<{ id: string; name: string; parentId: string | null }> } }
  | { status: 404; body: { result: 'not-found' } }
  | Denial;

/** 根机构守卫的 409 返回体（ADR 0014）：reason 供前端分辨，message 是给人看的一句原因。 */
function rootGuardOutcome(): InvalidState {
  return { status: 409, body: { result: 'invalid-state', reason: ROOT_GUARD_REASON, message: ROOT_GUARD_MESSAGE } };
}

/** 对方已停用的 409 返回体（#130 定口径，PR #148 复核遗留①）：编辑与调岗共用一个原因词。 */
function deactivatedOutcome(message: string): InvalidState {
  return {
    status: 409,
    body: { result: 'invalid-state', reason: PERSONNEL_DEACTIVATED_REASON, message },
  };
}

/** 恢复被拒的 409 返回体（#105 故事 38、39）。 */
function restoreInvalidOutcome(reason: RestoreInvalidReason): InvalidState {
  return { status: 409, body: { result: 'invalid-state', reason, message: RESTORE_INVALID_MESSAGE[reason] } };
}

/** 调入已停用机构的 409 返回体（#105:219）。 */
const DEACTIVATED_DEST_MESSAGE = '所选机构已停用，请选择在用的机构。';

function denial(error: unknown): { outcome: Denial; entry: AuditEntry | null } {
  if (!isAccessDenied(error)) throw error;
  return { outcome: { status: 403, body: { reason: error.reason } }, entry: error.denial };
}

const isoOrNull = (value: Date | null): string | null => value?.toISOString() ?? null;

/** 日历日（UTC 午夜）写成 YYYY-MM-DD。 */
const dayOrNull = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/**
 * 管理台人员（#128）：列表、卡片、登记。
 * 卡片和登记在交互式事务里完成，业务行与留痕同成同败（#119）；
 * 被拒绝的动作经 rejected(...) 回滚，拒绝留痕在回滚后另起事务写入。
 */
@Injectable()
export class PersonnelProfilesService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly profiles: PersonnelProfileService,
    private readonly credentials: CredentialService,
    private readonly auth: AuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: ActorRef): Promise<PersonnelListOutcome> {
    try {
      const list = await this.profiles.listPersonnel(actor, this.clock.now());
      return {
        status: 200,
        body: {
          result: 'listed',
          rootId: list.rootId,
          orgUnits: list.orgUnits.map((unit) => ({ ...unit, deactivatedAt: isoOrNull(unit.deactivatedAt) })),
          personnel: list.personnel.map((row) => ({ ...row, deactivatedAt: isoOrNull(row.deactivatedAt) })),
        },
      };
    } catch (error) {
      return denial(error).outcome;
    }
  }

  async card(actor: ActorRef, personnelId: string, sourceIp: string | null): Promise<PersonnelCardOutcome> {
    return this.uow.run<PersonnelCardOutcome>(async (tx) => {
      try {
        const read = await this.profiles.readProfile(actor, personnelId, tx, tx.audit, sourceIp, this.clock.now());
        if (read.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        const { profile } = read;
        return {
          status: 200,
          body: {
            result: 'viewed',
            personnel: {
              ...profile,
              passwordChangedAt: isoOrNull(profile.passwordChangedAt),
              deactivatedAt: isoOrNull(profile.deactivatedAt),
              cert: { ...profile.cert, expiresOn: dayOrNull(profile.cert.expiresOn) },
            },
          },
        };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<PersonnelCardOutcome>(outcome, entry) : outcome;
      }
    });
  }

  async register(
    actor: ActorRef,
    input: RegisterPersonnelProfileInput,
    sourceIp: string | null,
  ): Promise<RegisterPersonnelOutcome> {
    // 第一步：判断能否登记。不合规、越权、机构已停用时直接返回，不散列。
    const checked = await this.uow.run<RegisterPersonnelOutcome | { ready: true }>(async (tx) => {
      try {
        const screened = await this.profiles.screenRegistration(actor, input, tx, sourceIp);
        if (screened.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: screened.rules } };
        }
        if (screened.result === 'invalid-state') {
          return rejected<RegisterPersonnelOutcome>({ status: 409, body: { result: 'invalid-state' } }, screened.failure);
        }
        return { ready: true };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<RegisterPersonnelOutcome>(outcome, entry) : outcome;
      }
    });
    if (!('ready' in checked)) return checked;
    // 口令散列在事务之外计算（#119）。
    const passwordHash = await this.credentials.hashPassword(input.initialPassword);
    // 第二步：重新判断后写入。人员、名称版本、任职、人员—角色、岗位标记与留痕同一事务。
    return this.uow.run<RegisterPersonnelOutcome>(async (tx) => {
      try {
        const outcome = await this.profiles.registerPersonnel(actor, input, passwordHash, tx, tx.audit, sourceIp);
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        if (outcome.result === 'invalid-state') {
          return rejected<RegisterPersonnelOutcome>({ status: 409, body: { result: 'invalid-state' } }, outcome.failure);
        }
        if (outcome.result === 'already-exists') {
          return rejected<RegisterPersonnelOutcome>(
            { status: 409, body: { result: 'already-exists', conflict: outcome.conflict } },
            outcome.failure,
          );
        }
        return { status: 200, body: { result: 'registered', personnel: outcome.personnel } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<RegisterPersonnelOutcome>(outcome, entry) : outcome;
      }
    });
  }

  /**
   * 编辑（#129）：姓名、手机号、角色、岗位标记。在交互式事务里完成，业务行与留痕同成同败（#119）；
   * 被拒绝的动作经 rejected(...) 回滚，拒绝留痕在回滚后另起事务写入。
   */
  async edit(
    actor: ActorRef,
    personnelId: string,
    input: UpdatePersonnelProfileInput,
    sourceIp: string | null,
  ): Promise<EditPersonnelOutcome> {
    return this.uow.run<EditPersonnelOutcome>(async (tx) => {
      try {
        const outcome = await this.profiles.updateProfile(actor, personnelId, input, tx, tx.audit, sourceIp);
        if (outcome.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        if (outcome.result === 'already-exists') {
          return rejected<EditPersonnelOutcome>(
            { status: 409, body: { result: 'already-exists', conflict: outcome.conflict } },
            outcome.failure,
          );
        }
        if (outcome.result === 'personnel-deactivated') {
          return rejected<EditPersonnelOutcome>(deactivatedOutcome(DEACTIVATED_EDIT_MESSAGE), ...outcome.failures);
        }
        if (outcome.result === 'root-guard') {
          return rejected<EditPersonnelOutcome>(rootGuardOutcome(), outcome.failure);
        }
        return { status: 200, body: { result: 'updated' } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<EditPersonnelOutcome>(outcome, entry) : outcome;
      }
    });
  }

  /** 调岗（#129）：目的地不限数据范围，但必须是未停用机构；调出根机构受根机构守卫约束（ADR 0014）。 */
  async transfer(
    actor: ActorRef,
    personnelId: string,
    orgUnitId: string,
    sourceIp: string | null,
  ): Promise<TransferPersonnelOutcome> {
    return this.uow.run<TransferPersonnelOutcome>(async (tx) => {
      try {
        const outcome = await this.profiles.transferProfile(actor, personnelId, orgUnitId, tx, tx.audit, sourceIp);
        if (outcome.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        if (outcome.result === 'invalid-state') {
          return rejected<TransferPersonnelOutcome>(
            { status: 409, body: { result: 'invalid-state', message: DEACTIVATED_DEST_MESSAGE } },
            outcome.failure,
          );
        }
        if (outcome.result === 'personnel-deactivated') {
          return rejected<TransferPersonnelOutcome>(
            deactivatedOutcome(DEACTIVATED_TRANSFER_MESSAGE),
            outcome.failure,
          );
        }
        if (outcome.result === 'root-guard') {
          return rejected<TransferPersonnelOutcome>(rootGuardOutcome(), outcome.failure);
        }
        if (outcome.result === 'unchanged') return { status: 200, body: { result: 'unchanged' } };
        return { status: 200, body: { result: 'transferred', orgUnitId: outcome.orgUnitId } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<TransferPersonnelOutcome>(outcome, entry) : outcome;
      }
    });
  }

  /** 调岗目的地清单（#129）：全树未停用的机构。读取不写留痕。 */
  async transferDestinations(actor: ActorRef, personnelId: string): Promise<TransferDestinationsOutcome> {
    return this.uow.run<TransferDestinationsOutcome>(async (tx) => {
      try {
        const outcome = await this.profiles.listTransferDestinations(actor, personnelId, tx);
        if (outcome.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        return { status: 200, body: { result: 'listed', orgUnits: outcome.orgUnits } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<TransferDestinationsOutcome>(outcome, entry) : outcome;
      }
    });
  }

  /**
   * 停用（#130）。在交互式事务里完成，业务行与留痕同成同败（#119）。
   * 对方的全部会话在下一次请求时结束：认证编排发现人员已停用即结束会话与「记住我」，本请求不动会话表。
   * 重复停用返回 200，不写行、不写留痕，不改首次停用时间。
   */
  async deactivate(actor: ActorRef, personnelId: string, sourceIp: string | null): Promise<DeactivatePersonnelOutcome> {
    return this.uow.run<DeactivatePersonnelOutcome>(async (tx) => {
      try {
        const outcome = await this.profiles.deactivateProfile(actor, personnelId, tx, tx.audit, sourceIp);
        if (outcome.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        if (outcome.result === 'root-guard') {
          return rejected<DeactivatePersonnelOutcome>(rootGuardOutcome(), outcome.failure);
        }
        return { status: 200, body: { result: 'deactivated' } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<DeactivatePersonnelOutcome>(outcome, entry) : outcome;
      }
    });
  }

  /**
   * 恢复（#130，D7）：恢复、重设初始口令、解除锁定、结束残余会话和「记住我」在一个事务里。
   * 口令散列在事务之外计算（#119），所以先判断再散列再写入，写法照 A10 的重设初始口令。
   * 口令历史比对留给口令历史票（#132）。
   */
  async restore(
    actor: ActorRef,
    personnelId: string,
    input: RestorePersonnelProfileInput,
    sourceIp: string | null,
  ): Promise<RestorePersonnelOutcome> {
    // 第一步：判断能否恢复。不合规、越权、状态不允许时直接返回，不散列。
    const checked = await this.uow.run<RestorePersonnelOutcome | { ready: true }>(async (tx) => {
      try {
        const screened = await this.profiles.screenRestore(actor, personnelId, input, tx, sourceIp);
        return screened.result === 'ready' ? { ready: true } : this.restoreOutcome(screened);
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<RestorePersonnelOutcome>(outcome, entry) : outcome;
      }
    });
    if (!('ready' in checked)) return checked;
    const passwordHash = await this.credentials.hashPassword(input.initialPassword);
    // 第二步：重新判断后写入。身份组织的行与口令、会话、「记住我」同一事务。
    return this.uow.run<RestorePersonnelOutcome>(async (tx) => {
      try {
        // 一方快照取在恢复与调岗之前：留痕的机构写对方当时的任职机构（ADR 0011）。
        const before = await tx.directory.findById(personnelId);
        const outcome = await this.profiles.restoreProfile(actor, personnelId, input, tx, tx.audit, sourceIp);
        if (outcome.result !== 'restored') return this.restoreOutcome(outcome);
        const admin = await tx.directory.findById(actor.personnelId);
        const now = this.clock.now();
        const wasLocked = before?.lockedUntil != null && now.getTime() < before.lockedUntil.getTime();
        // 写入初始口令：上次改密时间留空（首登强制改密），并清零锁定。
        await tx.directory.applyInitialPassword(personnelId, passwordHash);
        const parties = {
          actorId: actor.personnelId,
          actorCode: admin?.code ?? null,
          subjectPersonnelId: personnelId,
          subjectCode: before?.code ?? null,
          orgUnitId: before?.orgUnitId ?? null,
          sourceIp,
        };
        await tx.audit.append({ action: 'account.password-reset', ...parties });
        // 同一次请求做成几件不同的事，就各写一行（ADR 0011）：解锁另记一行。
        if (wasLocked) await tx.audit.append({ action: 'account.unlocked', ...parties });
        await this.auth.endPersonnelSessions({
          personnelId,
          actorId: actor.personnelId,
          actorCode: admin?.code ?? '',
          sourceIp,
        }, tx);
        await tx.remember.endActiveForPersonnel(personnelId, now, 'admin-ended');
        return { status: 200, body: { result: 'restored', orgUnitId: outcome.orgUnitId } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<RestorePersonnelOutcome>(outcome, entry) : outcome;
      }
    });
  }

  /** 恢复的拒绝结果 → 接口返回。 */
  private restoreOutcome(
    outcome:
      | { result: 'not-found' }
      | { result: 'non-compliant'; rules: RestoreRuleCode[] }
      | { result: 'invalid-state'; reason: RestoreInvalidReason; failure: AuditEntry }
      | { result: 'root-guard'; failure: AuditEntry },
  ): RestorePersonnelOutcome | Rejected<RestorePersonnelOutcome> {
    if (outcome.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
    if (outcome.result === 'non-compliant') {
      return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
    }
    if (outcome.result === 'root-guard') return rejected<RestorePersonnelOutcome>(rootGuardOutcome(), outcome.failure);
    return rejected<RestorePersonnelOutcome>(restoreInvalidOutcome(outcome.reason), outcome.failure);
  }

  /**
   * 结束全部会话（#130，#105 故事 40）：每段写一行 session.ended（admin-ended），
   * 另写一行 personnel.sessions-ended，同一事务，不改口令。「记住我」一并作废，不单独记（ADR 0011）。
   */
  async endSessions(actor: ActorRef, personnelId: string, sourceIp: string | null): Promise<EndSessionsOutcome> {
    return this.uow.run<EndSessionsOutcome>(async (tx) => {
      try {
        const authorized = await this.profiles.authorizeSessionsEnd(actor, personnelId, tx, sourceIp);
        if (authorized.result === 'not-found') return { status: 404, body: { result: 'not-found' } };
        const admin = await tx.directory.findById(actor.personnelId);
        await this.auth.endPersonnelSessions({
          personnelId,
          actorId: actor.personnelId,
          actorCode: admin?.code ?? '',
          sourceIp,
        }, tx);
        await tx.remember.endActiveForPersonnel(personnelId, this.clock.now(), 'admin-ended');
        await tx.audit.append({ action: 'personnel.sessions-ended', ...authorized.parties });
        return { status: 200, body: { result: 'ended' } };
      } catch (error) {
        const { outcome, entry } = denial(error);
        return entry ? rejected<EndSessionsOutcome>(outcome, entry) : outcome;
      }
    });
  }
}
