// 其他（#229）登记、不予立案落点（#226）、结案提醒生成与提醒处理（#217／#226／#229）。
//
// #226：HTTP POST disposition=no-case 一律拒绝（filing-approval-required）；不予立案只经
// 不予立案落点只许由立案呈批批准路径调用（#234）；本服务不再包装。
// other（#229）仍走本服务 HTTP 路径：仅已派承办人；主办／协办本人或承办机构内勤。
//
// 结案提醒：提醒挂在「不派」的暂存线索上，对方是被结案的线索。处理人二选一——
// 撤回不派再办（回待分派池，写撤回行）或写明原因随旧线索办结（进 closed，写处置行）。
// 系统不自动派、不自动关；本期无超期、催办或升级。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueDispositionRecordedFailedReason,
  type ClueReminderResolvedFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CLUE_STORE,
  DISPOSITION_RECORD_FROM_STATUS,
  REMINDER_RESOLUTIONS,
  WITHDRAW_FROM_STATUS,
  WITHDRAW_REASONS,
  checkDispositionNote,
  checkReminderResolve,
  generateClosureReminders,
  type CaseStore,
  type ClueStore,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
  type IdentityStore,
} from '@natural-enforcement/identity';
import { findSourceCode } from '@natural-enforcement/geo-dict';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const DISPOSITION_OPCODE = 'clue.disposition.record';
const REMINDER_OPCODE = 'clue.reminder.resolve';
const READ_OPCODE = 'clue.read';

/** 不予立案登记结果。 */
export type DispositionOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'disposition-recorded';
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
        /** 生成的结案提醒条数。 */
        readonly reminderCount: number;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

/** 提醒处理结果。 */
export type ReminderResolveOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'reminder-resolved';
        readonly reminderId: string;
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
        readonly resolution: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

/** 不派视图。 */
export interface HeldListOutcome {
  readonly status: 200 | 403;
  readonly body: unknown;
}

/** 结案提醒列表。 */
export interface ReminderListOutcome {
  readonly status: 200 | 403;
  readonly body: unknown;
}

interface Rejection {
  readonly status: 400 | 409;
  readonly result: 'non-compliant' | 'invalid-state' | 'concurrent-change';
  readonly rules: readonly string[];
  readonly reason: string;
}

@Injectable()
export class ClueClosureService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
  ) {}

  /**
   * HTTP 处置登记入口：仅受理 other（#229）。
   * disposition=no-case 一律 400 filing-approval-required（#226），业务行不变、写失败留痕。
   * other：仅已派承办人，主办／协办本人或承办机构内勤；核查正交不阻止。
   */
  async recordNoCase(
    actor: ActorRef,
    clueId: string,
    input: { readonly disposition: string; readonly note: string; readonly expectedStatus: string },
  ): Promise<DispositionOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const assignment = context.assignment;

    // 授权第一层：对象级（主办／协办本人或承办机构内勤）。
    const actingOrgId = this.handlerOrgId(actor, account, context);
    if (actingOrgId === null) {
      await this.deny(actor, actorCode, actorOrgId, DISPOSITION_OPCODE, clueId, assignment?.orgUnitId ?? context.enteredOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    // 授权第二层：操作码。拒绝时 authorize 自己写 authz.denied 留痕。
    try {
      await this.access.authorize(actor, DISPOSITION_OPCODE, actingOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    // #226：HTTP 直接登记不予立案一律拒绝（须经立案呈批落点服务）。
    if (input.disposition === 'no-case') {
      return this.rejectDisposition(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['filing-approval-required'],
        reason: 'filing-approval-required',
      });
    }
    // #234 X31：立案呈批在途时不能做其他处置。
    if (await this.cases.hasPendingFilingApproval(clueId)) {
      return this.rejectDisposition(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'filing-approval-pending',
      });
    }

    // 规则：本期 HTTP 只受理其他（#229）；移送归 #216 接口。理由必填。
    if (input.disposition !== 'other') {
      return this.rejectDisposition(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['unsupported-disposition'],
        reason: 'unsupported-disposition',
      });
    }
    if (!checkDispositionNote(input.note).ok) {
      return this.rejectDisposition(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['missing-disposition-fields'],
        reason: 'missing-disposition-fields',
      });
    }
    const guard = this.stateGuard(context.status, input.expectedStatus, [
      DISPOSITION_RECORD_FROM_STATUS,
    ]);
    if (guard) {
      return this.rejectDisposition(actor, actorCode, actorOrgId, clueId, guard);
    }

    // 处置事实、终态、结案提醒与成功留痕同成同败；并发冲突回滚后另起事务写失败留痕。
    return this.uow.run(async (tx) => {
      const recordedAt = new Date();
      const applied = await tx.clues.applyDisposition({
        clueId,
        expectedStatus: input.expectedStatus,
        dispositionId: newUlid(),
        disposition: 'other',
        transferredOrg: null,
        documentNo: null,
        note: input.note.trim(),
        recordedBy: actor.personnelId,
        recordedAt,
        nextStatus: 'closed',
      });
      if (!applied) {
        return rejected<DispositionOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'clue.disposition-recorded',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, actorOrgId, clueId, DISPOSITION_OPCODE),
          },
        );
      }
      // other 用提醒类型 other（#229），不复用 no-case。
      const reminderIds = await generateClosureReminders(tx.clues, {
        closedClueId: clueId,
        kind: 'other',
        createdAt: recordedAt,
        newId: () => newUlid(),
      });
      await tx.audit.append({
        action: 'clue.disposition-recorded',
        ...this.parties(actor, actorCode, actorOrgId, clueId, DISPOSITION_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          disposition: 'other',
          reminderCount: reminderIds.length,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'disposition-recorded' as const,
          clueId,
          code: context.code,
          status: 'closed',
          reminderCount: reminderIds.length,
        },
      };
    });
  }

  /**
   * 不予立案落点（#226）：非 HTTP、不授角色。
   * 供案件段立案呈批 doc.approve（结论为不予立案）同一事务调用；IT 直接调本方法验证。
   * 成功写处置＋呈批引用＋理由快照＋closed＋kind=no-case 提醒＋成功留痕；失败写失败留痕、业务行不变。
   */

  /** 结案提醒处理：撤回不派再办｜写明原因随旧线索办结。 */
  async resolveReminder(
    actor: ActorRef,
    reminderId: string,
    input: {
      readonly resolution: string;
      readonly reasonCodes: readonly string[];
      readonly note: string;
      readonly expectedStatus: string;
    },
  ): Promise<ReminderResolveOutcome> {
    const reminder = await this.clues.readClosureReminder(reminderId);
    if (!reminder) return { status: 404, body: { result: 'not-found' } };
    const context = await this.clues.readDispatchContext(reminder.clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;

    // 授权第一层：对象级（暂存线索录入人、录入机构内勤、所撞旧线索承办机构内勤）。
    const actingOrgId = this.reminderOrgId(actor, account, reminder);
    if (actingOrgId === null) {
      await this.deny(actor, actorCode, actorOrgId, REMINDER_OPCODE, reminder.clueId, reminder.enteredOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    // 授权第二层：操作码。拒绝时 authorize 自己写 authz.denied 留痕。
    try {
      await this.access.authorize(actor, REMINDER_OPCODE, actingOrgId, {
        resourceType: 'clue',
        resourceId: reminder.clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    // 提醒已处理即失效：不再受理。
    if (reminder.resolvedAt !== null) {
      return this.rejectReminder(actor, actorCode, actorOrgId, reminder.clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'invalid-state',
      });
    }
    // 规则：二选一；撤回不派再办走四项原因与说明校验，随旧线索办结只要说明。
    const checked = checkReminderResolve({
      resolution: input.resolution,
      reasonCodes: input.reasonCodes,
      note: input.note,
    });
    if (!checked.ok) {
      return this.rejectReminder(actor, actorCode, actorOrgId, reminder.clueId, {
        status: 400,
        result: 'non-compliant',
        rules: [checked.rule],
        reason: checked.rule,
      });
    }
    const resolution = input.resolution as (typeof REMINDER_RESOLUTIONS)[number];
    const guard = this.stateGuard(context.status, input.expectedStatus, [WITHDRAW_FROM_STATUS]);
    if (guard) {
      return this.rejectReminder(actor, actorCode, actorOrgId, reminder.clueId, guard);
    }

    const reasonCodes = [
      ...new Set(input.reasonCodes.map((code) => code.trim()).filter((code) => code !== '')),
    ];
    const note = input.note.trim();
    const nextStatus = resolution === 'withdraw' ? 'in_pool' : 'closed';

    // 状态写入、处置／撤回事实与成功留痕同成同败。
    return this.uow.run(async (tx) => {
      const resolvedAt = new Date();
      const applied = await tx.clues.applyReminderResolution({
        reminderId,
        clueId: reminder.clueId,
        expectedStatus: input.expectedStatus,
        resolution,
        withdrawalId: resolution === 'withdraw' ? newUlid() : null,
        reasonCodes,
        note,
        dispositionId: resolution === 'close-with-old' ? newUlid() : null,
        resolvedBy: actor.personnelId,
        resolvedAt,
      });
      if (!applied) {
        return rejected<ReminderResolveOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'clue.reminder-resolved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, actorOrgId, reminder.clueId, REMINDER_OPCODE),
          },
        );
      }
      // 处置事实各按自己的动作词留痕：撤回不派记 clue.withdrawn，随旧线索办结记 clue.disposition-recorded。
      if (resolution === 'withdraw') {
        await tx.audit.append({
          action: 'clue.withdrawn',
          ...this.parties(actor, actorCode, actorOrgId, reminder.clueId, REMINDER_OPCODE),
          detail: JSON.stringify({ code: reminder.clueCode, reasonCodes }),
        });
      } else {
        await tx.audit.append({
          action: 'clue.disposition-recorded',
          ...this.parties(actor, actorCode, actorOrgId, reminder.clueId, REMINDER_OPCODE),
          detail: JSON.stringify({ code: reminder.clueCode, disposition: 'with-old' }),
        });
      }
      await tx.audit.append({
        action: 'clue.reminder-resolved',
        ...this.parties(actor, actorCode, actorOrgId, reminder.clueId, REMINDER_OPCODE),
        detail: JSON.stringify({
          reminderId,
          clueId: reminder.clueId,
          code: reminder.clueCode,
          resolution,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'reminder-resolved' as const,
          reminderId,
          clueId: reminder.clueId,
          code: reminder.clueCode,
          status: nextStatus,
          resolution,
        },
      };
    });
  }

  /**
   * 撤回不派与结案提醒的界面口径：四项常用原因由服务端给，界面不另存一份。
   */
  async readOptions(): Promise<{ readonly status: 200; readonly body: unknown }> {
    return {
      status: 200,
      body: { result: 'closure-options', withdrawReasons: [...WITHDRAW_REASONS] },
    };
  }

  /** 不派视图：数据范围内当前「不派」、且当前操作者可撤回的线索。 */
  async listHeld(actor: ActorRef): Promise<HeldListOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    try {
      await this.access.authorize(actor, READ_OPCODE, actorOrgId, { resourceType: 'clue' });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const scope = await this.scopeOrgIds(actorOrgId);
    const rows = await this.clues.listHeldClues(scope);
    const clues = rows.map((row) => ({
      clueId: row.id,
      code: row.code,
      status: row.status,
      domain: row.domain,
      sourceCode: row.sourceCode,
      sourceName: findSourceCode(row.sourceCode)?.name ?? row.sourceCode,
      registeredAt: row.registeredAt.toISOString(),
      hitCodes: row.hitCodes,
      mayWithdraw: this.mayWithdrawHeld(actor, account, row),
    }));
    return { status: 200, body: { result: 'held-list', clues } };
  }

  /** 结案提醒列表：数据范围内未处理的提醒。 */
  async listReminders(actor: ActorRef): Promise<ReminderListOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    try {
      await this.access.authorize(actor, READ_OPCODE, actorOrgId, { resourceType: 'clue' });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const scope = await this.scopeOrgIds(actorOrgId);
    const rows = await this.clues.listPendingClosureReminders(scope);
    const reminders = rows.map((row) => ({
      reminderId: row.id,
      clueId: row.clueId,
      clueCode: row.clueCode,
      kind: row.kind,
      otherClueId: row.otherClueId,
      otherClueCode: row.otherClueCode,
      otherStatus: row.otherStatus,
      createdAt: row.createdAt.toISOString(),
      mayResolve: this.mayResolveReminder(actor, account, row),
    }));
    return { status: 200, body: { result: 'reminder-list', reminders } };
  }

  /** 数据范围：操作者当前任职机构及其下级。 */
  private async scopeOrgIds(actorOrgId: string): Promise<readonly string[]> {
    if (actorOrgId === '') return [];
    return this.identity.listOrgUnitSubtreeIds(actorOrgId);
  }

  /** 不予立案的对象级权限与据以行事的机构：主办／协办本人或承办机构内勤。 */
  private handlerOrgId(
    actor: ActorRef,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    context: {
      readonly handlers: readonly { readonly personnelId: string; readonly role: string }[];
      readonly assignment: { readonly orgUnitId: string } | null;
    },
  ): string | null {
    const assignment = context.assignment;
    if (assignment === null) return null;
    if (context.handlers.some((handler) => handler.personnelId === actor.personnelId)) {
      return assignment.orgUnitId;
    }
    const roles = account?.roles ?? [];
    if (!roles.includes('内勤')) return null;
    if (account?.orgUnitId !== assignment.orgUnitId) return null;
    return assignment.orgUnitId;
  }

  /** 提醒处理的对象级权限与据以行事的机构。 */
  private reminderOrgId(
    actor: ActorRef,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    reminder: {
      readonly registeredBy: string;
      readonly enteredOrgId: string;
      readonly otherHandlerOrgId: string | null;
    },
  ): string | null {
    if (reminder.registeredBy === actor.personnelId) return reminder.enteredOrgId;
    const roles = account?.roles ?? [];
    const actorOrg = account?.orgUnitId ?? null;
    if (actorOrg === null || !roles.includes('内勤')) return null;
    if (actorOrg === reminder.enteredOrgId) return reminder.enteredOrgId;
    if (actorOrg === reminder.otherHandlerOrgId) return reminder.otherHandlerOrgId;
    return null;
  }

  /** 不派视图里的撤回权限（界面 affordance）。 */
  private mayWithdrawHeld(
    actor: ActorRef,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    row: {
      readonly registeredBy: string;
      readonly enteredOrgId: string;
      readonly hitHandlerOrgIds: readonly string[];
    },
  ): boolean {
    if (row.registeredBy === actor.personnelId) return true;
    const roles = account?.roles ?? [];
    const actorOrg = account?.orgUnitId ?? null;
    if (actorOrg === null || !roles.includes('内勤')) return false;
    if (actorOrg === row.enteredOrgId) return true;
    return row.hitHandlerOrgIds.includes(actorOrg);
  }

  /** 提醒列表里的处理权限（界面 affordance）。 */
  private mayResolveReminder(
    actor: ActorRef,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    row: {
      readonly registeredBy: string;
      readonly enteredOrgId: string;
      readonly otherHandlerOrgId: string | null;
    },
  ): boolean {
    return this.reminderOrgId(actor, account, row) !== null;
  }

  /** 状态守卫：expectedStatus 不符即并发冲突；状态不在允许集合即 invalid-state。 */
  private stateGuard(
    actual: string,
    expected: string,
    allowed: readonly string[],
  ): Rejection | null {
    if (actual !== expected) {
      return { status: 409, result: 'concurrent-change', rules: [], reason: 'concurrent-change' };
    }
    if (!allowed.includes(actual)) {
      return { status: 409, result: 'invalid-state', rules: [], reason: 'invalid-state' };
    }
    return null;
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async deny(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    opcode: string,
    resourceId: string,
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
      opcode,
      resourceType: 'clue',
      resourceId,
      previousValue: null,
      targetOrgUnitId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<ReminderResolveOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 处置登记拒绝类留痕：回滚后另起事务写入。 */
  private async rejectDisposition(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<DispositionOutcome> {
    const outcome: DispositionOutcome =
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
      rejected<DispositionOutcome>(outcome, {
        action: 'clue.disposition-recorded',
        outcome: 'failed',
        reason: rejection.reason as ClueDispositionRecordedFailedReason,
        ...this.parties(actor, actorCode, orgUnitId, clueId, DISPOSITION_OPCODE),
      }),
    );
    return outcome;
  }

  /** 提醒处理拒绝类留痕：回滚后另起事务写入。资源列为线索（提醒挂在该线索上）。 */
  private async rejectReminder(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<ReminderResolveOutcome> {
    const outcome: ReminderResolveOutcome =
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
      rejected<ReminderResolveOutcome>(outcome, {
        action: 'clue.reminder-resolved',
        outcome: 'failed',
        reason: rejection.reason as ClueReminderResolvedFailedReason,
        ...this.parties(actor, actorCode, orgUnitId, clueId, REMINDER_OPCODE),
      }),
    );
    return outcome;
  }

  /** 留痕的当事人列。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    resourceId: string,
    opcode: string,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'clue',
      resourceId,
    };
  }
}
