// 撤回不派（#217；规格 D 节、GLOSSARY「撤回不派」）。
//
// 对象：「不派」线索（held）。有权人＝录入人本人、录入机构内勤、所撞既有线索承办机构内勤；
// 监督不能（无操作码，授权层即拒）。四项常用原因逐字采用原型，可多选且至少一项，
// 补充说明必填；校验失败 400 non-compliant 不改状态并写失败留痕；成功回待分派池（in_pool），
// 留痕 clue.withdrawn（撤回原因编码），撤回行落 ClueWithdrawal.reason_codes（数组列）。
//
// POST /api/clues/:id/withdraw

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueWithdrawnFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  WITHDRAW_FROM_STATUS,
  checkWithdrawInput,
  type ClueStore,
  type ClueWithdrawContext,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
} from '@natural-enforcement/identity';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const WITHDRAW_OPCODE = 'clue.withdraw.undo';

/** 撤回不派结果。 */
export type WithdrawOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'withdrawn';
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

interface Rejection {
  readonly status: 400 | 409;
  readonly result: 'non-compliant' | 'invalid-state' | 'concurrent-change';
  readonly rules: readonly string[];
  readonly reason: string;
}

@Injectable()
export class ClueWithdrawService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
  ) {}

  /** 撤回不派：成功后线索回待分派池，可再走派机构（expectedStatus=in_pool）。 */
  async withdraw(
    actor: ActorRef,
    clueId: string,
    input: { readonly reasonCodes: readonly string[]; readonly note: string; readonly expectedStatus: string },
  ): Promise<WithdrawOutcome> {
    const context = await this.clues.readWithdrawContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;

    // 授权第一层：操作码。拒绝时 authorize 自己写 authz.denied 留痕。
    try {
      await this.access.authorize(actor, WITHDRAW_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（录入人本人、录入机构内勤、所撞既有线索承办机构内勤）。
    if (!(await this.mayWithdraw(actor, account, context))) {
      await this.deny(actor, actorCode, actorOrgId, clueId, context.enteredOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (context.status !== input.expectedStatus) {
      return this.reject(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'concurrent-change',
        rules: [],
        reason: 'concurrent-change',
      });
    }
    if (context.status !== WITHDRAW_FROM_STATUS) {
      return this.reject(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'invalid-state',
      });
    }
    // 规则：四项常用原因至少一项、说明必填（校验失败不改状态，失败留痕）。
    const checked = checkWithdrawInput({ reasonCodes: input.reasonCodes, note: input.note });
    if (!checked.ok) {
      return this.reject(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: [checked.rule],
        reason: checked.rule,
      });
    }
    const reasonCodes = [...new Set(input.reasonCodes.map((code) => code.trim()).filter((code) => code !== ''))];

    // 撤回行、状态回写与成功留痕同成同败；并发冲突回滚后另起事务写失败留痕。
    return this.uow.run(async (tx) => {
      const applied = await tx.clues.applyWithdrawal({
        clueId,
        expectedStatus: input.expectedStatus,
        withdrawalId: newUlid(),
        reasonCodes,
        note: input.note.trim(),
        withdrawnBy: actor.personnelId,
        withdrawnAt: new Date(),
      });
      if (!applied) {
        return rejected<WithdrawOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'clue.withdrawn',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, actorOrgId, clueId),
          },
        );
      }
      await tx.audit.append({
        action: 'clue.withdrawn',
        ...this.parties(actor, actorCode, actorOrgId, clueId),
        detail: JSON.stringify({ code: context.code, reasonCodes }),
      });
      return {
        status: 200,
        body: { result: 'withdrawn' as const, clueId, code: context.code, status: 'in_pool' },
      };
    });
  }

  /** 对象级权限：录入人本人；录入机构内勤；所撞既有线索承办机构内勤。 */
  private async mayWithdraw(
    actor: ActorRef,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    context: ClueWithdrawContext,
  ): Promise<boolean> {
    if (context.registeredBy === actor.personnelId) return true;
    const roles = account?.roles ?? [];
    const actorOrg = account?.orgUnitId ?? null;
    if (actorOrg === null || !roles.includes('内勤')) return false;
    if (actorOrg === context.enteredOrgId) return true;
    return context.hits.some((hit) => hit.otherHandlerOrgId !== null && hit.otherHandlerOrgId === actorOrg);
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async deny(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    targetOrgUnitId: string,
  ): Promise<void> {
    const denial: AuthzDeniedEntry = {
      action: 'authz.denied',
      outcome: 'failed',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      reason: 'permission-denied',
      opcode: WITHDRAW_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
      previousValue: null,
      targetOrgUnitId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<WithdrawOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 拒绝类留痕：回滚后另起事务写入。 */
  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<WithdrawOutcome> {
    const outcome: WithdrawOutcome =
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          };
    await this.uow.run(async () =>
      rejected<WithdrawOutcome>(
        outcome,
        {
          action: 'clue.withdrawn',
          outcome: 'failed',
          reason: rejection.reason as ClueWithdrawnFailedReason,
          ...this.parties(actor, actorCode, orgUnitId, clueId),
        },
      ),
    );
    return outcome;
  }

  /** 留痕的当事人列。 */
  private parties(actor: ActorRef, actorCode: string | null, orgUnitId: string, clueId: string): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: WITHDRAW_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}
