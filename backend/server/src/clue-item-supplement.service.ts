// 线索缺件补齐（#211；规格 E「缺件补齐支持单项和一键（多项同一次提交）」）。
//
// 一次提交可补一项，也可一次补多项。同一次提交里任一项不合格则全部不保存：
// 校验在写之前做完，不合格即 400 non-compliant（失败留痕，业务行不变）。
// 补齐后缺件清单随之外（缺件行保留为事实，补齐时间写在行上），并留痕 clue.items-supplemented。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type ClueItemsSupplementFailedReason,
} from '@natural-enforcement/audit';
import { CLUE_STORE, type ClueFormValues, type ClueStore } from '@natural-enforcement/case';
import {
  AccessControlService,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
} from '@natural-enforcement/identity';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const SUPPLEMENT_OPCODE = 'clue.item.supplement';

/** 补齐结果。 */
export interface ClueItemSupplementBody {
  readonly result: 'supplemented';
  readonly clueId: string;
  readonly code: string;
  /** 本次补齐的要件键。 */
  readonly filled: readonly { readonly key: string; readonly label: string }[];
  /** 仍未补齐的缺件。 */
  readonly gaps: readonly { readonly key: string; readonly label: string }[];
}

export type ClueItemSupplementOutcome =
  | { readonly status: 200; readonly body: ClueItemSupplementBody }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

/** 校验不通过：规则码与失败原因。 */
interface Rejection {
  readonly rules: readonly string[];
  readonly reason: ClueItemsSupplementFailedReason;
}

@Injectable()
export class ClueItemSupplementService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
  ) {}

  async fill(
    actor: ActorRef,
    clueId: string,
    values: ClueFormValues,
  ): Promise<ClueItemSupplementOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';

    const clue = await this.clues.readRegistrationResult(clueId);
    if (!clue) return { status: 404, body: { result: 'not-found' } };

    // 授权：操作码 + 对象所属机构的数据范围。
    const target = await this.clues.readClueOrgUnitId(clueId);
    try {
      await this.access.authorize(actor, SUPPLEMENT_OPCODE, target ?? actorOrgId);
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    const openGaps = await this.clues.listOpenGaps(clueId);
    const openKeys = new Set(openGaps.map((gap) => gap.key));
    const submitted = Object.entries(values).filter(([, value]) => value.trim() !== '');
    const unknown = submitted.filter(([key]) => !openKeys.has(key));
    if (unknown.length > 0) {
      return this.reject(actor, account?.code ?? null, actorOrgId, {
        rules: ['value-invalid'],
        reason: 'invalid-form',
      });
    }
    if (submitted.length === 0) {
      return this.reject(actor, account?.code ?? null, actorOrgId, {
        rules: ['missing-required-items'],
        reason: 'missing-required-items',
      });
    }

    const gapIds = openGaps
      .filter((gap) => submitted.some(([key]) => key === gap.key))
      .map((gap) => gap.id);

    return this.uow.run(async (tx) => {
      const outcome = await tx.clues.fillGaps({
        clueId,
        values: submitted.map(([key, value]) => ({ id: newUlid(), key, value })),
        gapIds,
        filledAt: new Date(),
      });
      const filled = outcome.filledKeys.map((key) => {
        const gap = openGaps.find((item) => item.key === key);
        return { key, label: gap?.label ?? key };
      });
      await tx.audit.append({
        action: 'clue.items-supplemented',
        ...this.parties(actor, account?.code ?? null, actorOrgId, clueId),
        detail: JSON.stringify({ code: clue.code, filledKeys: outcome.filledKeys }),
      });
      return {
        status: 200,
        body: {
          result: 'supplemented' as const,
          clueId,
          code: clue.code,
          filled,
          gaps: outcome.remaining,
        },
      };
    });
  }

  /** 失败留痕：拒绝类留痕在回滚后另起事务写入（#119 口径）。 */
  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    rejection: Rejection,
  ): Promise<ClueItemSupplementOutcome> {
    const outcome: ClueItemSupplementOutcome = {
      status: 400,
      body: { result: 'non-compliant', rules: rejection.rules },
    };
    await this.uow.run(async () =>
      rejected<ClueItemSupplementOutcome>(outcome, {
        action: 'clue.items-supplemented',
        outcome: 'failed',
        reason: rejection.reason,
        ...this.parties(actor, actorCode, orgUnitId, null),
      }),
    );
    return outcome;
  }

  /** 留痕的当事人列。要件取值不进留痕（规格 G）。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string | null,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: SUPPLEMENT_OPCODE,
      resourceType: clueId === null ? null : 'clue',
      resourceId: clueId,
    };
  }
}
