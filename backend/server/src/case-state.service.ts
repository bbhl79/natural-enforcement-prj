// 案件状态机的读写（#235）。判定在 case 包的纯函数里，这里只喂事实、落库、写留痕。
// 未启用的边、起点不符、X12、X13、X17、X18 都不改业务行。警告与提示同样不改业务行。

import { Inject, Injectable } from '@nestjs/common';
import { rejected, type CaseTransitionedFailedReason } from '@natural-enforcement/audit';
import {
  CASE_INSTANCE_STATUS_NAMES,
  CASE_MAIN_STATUS_NAMES,
  CASE_STAGE_NAMES,
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  CLUE_STORE,
  decideTransition,
  type CaseMainStatus,
  type CaseStore,
  type CaseView,
  type ClueStore,
  type TransitionDecision,
  type TransitionSubject,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { CLOCK, type Clock } from './clock.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const TRANSITION_OPCODE = 'doc.approve';
const CHAIN_OPCODE = 'doc.submit';
const CHAIN_KIND = /^[a-z0-9-]{1,40}$/;

const FAIL_REASONS = new Set<string>([
  'transition-disabled',
  'invalid-state',
  'unknown-transition',
  'X12',
  'X13',
  'X17',
  'X18',
  'advisory',
  'concurrent-change',
]);

export type CaseStateHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: { readonly result: string; readonly reason: string } }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: {
        readonly result: string;
        readonly reason: string;
        readonly message: string;
        readonly basis: string | null;
        readonly outlet: string;
      };
    };

@Injectable()
export class CaseStateService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<CaseStateHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    return { status: 200, body: presentCase(view) };
  }

  async transition(
    actor: ActorRef,
    caseId: string,
    input: { readonly transitionId: string; readonly handlingOrgId: string | null },
  ): Promise<CaseStateHttpOutcome> {
    const loaded = await this.load(caseId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const gate = await this.gateWrite(actor, actorCode, TRANSITION_OPCODE, loaded, caseId);
    if (gate) return gate;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: input.transitionId },
      subject: { ...loaded.subject, proposedHandlingOrgId: input.handlingOrgId },
    });
    if (!decision.ok) return this.settle(actor, actorCode, loaded.view.handlingOrgId, caseId, decision);
    const effects = decision.effects;
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const wrote = await persistTransitionEffects(tx.cases, {
        effects,
        caseId,
        clueId: loaded.view.sourceClueIds[0] ?? null,
        actorId: actor.personnelId,
        at,
        fromJson: JSON.stringify({
          stage: loaded.view.currentStage,
          status: loaded.view.status,
          stageEntrySeq: loaded.view.stageEntrySeq,
        }),
        toJson: JSON.stringify({
          stage: effects.currentStage,
          status: effects.mainStatus,
          stageEntrySeq: effects.stageEntrySeq,
        }),
        newId: () => newUlid(),
      });
      if (!wrote) {
        return rejected<CaseStateHttpOutcome>(blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'), {
          action: 'case.transitioned',
          outcome: 'failed',
          reason: 'concurrent-change',
          ...this.parties(actor, actorCode, loaded.view.handlingOrgId, caseId, TRANSITION_OPCODE),
        });
      }
      if (effects.kind === 'advance' && effects.currentStage && effects.mainStatus && effects.stageEntrySeq) {
        const moved = await tx.cases.advanceCasePointer({
          caseId,
          expectedStage: loaded.view.currentStage,
          expectedSeq: loaded.view.stageEntrySeq,
          stage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          status: effects.mainStatus,
        });
        if (!moved) {
          return rejected<CaseStateHttpOutcome>(
            blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.transitioned',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(actor, actorCode, loaded.view.handlingOrgId, caseId, TRANSITION_OPCODE),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.transitioned',
        ...this.parties(actor, actorCode, loaded.view.handlingOrgId, caseId, TRANSITION_OPCODE),
        detail: JSON.stringify({ transitionId: input.transitionId, caseId }),
      });
      const view = await tx.cases.readCaseView(caseId);
      return { status: 200 as const, body: view ? presentCase(view) : { result: 'transitioned', caseId } };
    });
  }

  async openApprovalChain(
    actor: ActorRef,
    caseId: string,
    input: { readonly kind: string },
  ): Promise<CaseStateHttpOutcome> {
    if (!CHAIN_KIND.test(input.kind)) {
      return { status: 400, body: { result: 'non-compliant', reason: 'invalid-approval-chain-kind' } };
    }
    const loaded = await this.load(caseId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const gate = await this.gateWrite(actor, actorCode, CHAIN_OPCODE, loaded, caseId);
    if (gate) return gate;
    const decision = decideTransition({
      operation: { kind: 'open-approval-chain' },
      subject: loaded.subject,
    });
    if (!decision.ok) {
      return this.settle(actor, actorCode, loaded.view.handlingOrgId, caseId, decision, CHAIN_OPCODE);
    }
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId,
        kind: input.kind,
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseStateHttpOutcome>(
          blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或撤回当前审批链'),
          {
            action: 'case.transitioned',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(actor, actorCode, loaded.view.handlingOrgId, caseId, CHAIN_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.transitioned',
        ...this.parties(actor, actorCode, loaded.view.handlingOrgId, caseId, CHAIN_OPCODE),
        detail: JSON.stringify({ kind: 'open-approval-chain', chainId, caseId }),
      });
      const view = await tx.cases.readCaseView(caseId);
      return {
        status: 200 as const,
        body: {
          result: 'approval-chain-opened',
          chainId,
          caseId,
          status: view?.status ?? loaded.view.status,
          currentStage: view?.currentStage ?? loaded.view.currentStage,
          stageEntrySeq: view?.stageEntrySeq ?? loaded.view.stageEntrySeq,
        },
      };
    });
  }

  private async load(caseId: string): Promise<{ view: CaseView; subject: TransitionSubject } | null> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return null;
    const clueId = view.sourceClueIds[0];
    const clue = clueId ? await this.clues.readDispatchContext(clueId) : null;
    return {
      view,
      subject: {
        caseId: view.id,
        mainStatus: view.status,
        stage: view.currentStage,
        stageEntrySeq: view.stageEntrySeq,
        suspended: false,
        markers: [],
        clueStatus: clue?.status ?? null,
        handlingOrgId: view.handlingOrgId,
        proposedHandlingOrgId: null,
        actorRoles: [],
        otherInFlightChains: await this.cases.countInFlightApprovals(caseId),
        instances: view.instances.map((row) => ({
          stage: row.stage,
          entrySeq: row.entrySeq,
          status: row.status,
        })),
      },
    };
  }

  /** 写入口的授权。只有监督角色时改记 X17，不推进主状态。 */
  private async gateWrite(
    actor: ActorRef,
    actorCode: string | null,
    opcode: string,
    loaded: { view: CaseView; subject: TransitionSubject },
    caseId: string,
  ): Promise<CaseStateHttpOutcome | null> {
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    loaded.subject = { ...loaded.subject, actorRoles: roles };
    const denied = await this.authorize(actor, opcode, loaded.view.handlingOrgId, caseId);
    if (!denied) return null;
    const onlySupervision = roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE);
    if (denied === 'permission-denied' && onlySupervision) {
      return this.fail(actor, actorCode, loaded.view.handlingOrgId, caseId, opcode, {
        reason: 'X17',
        message: '监督角色不能推进案件',
        citation: 'GLOSSARY「监督」',
        outlet: '请由有权办理人操作，监督不能推进主状态',
      });
    }
    return { status: 403, body: { reason: denied } };
  }

  private async settle(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    caseId: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
    opcode = TRANSITION_OPCODE,
  ): Promise<CaseStateHttpOutcome> {
    if (decision.level === 'block') {
      return this.fail(actor, actorCode, orgUnitId, caseId, opcode, {
        reason: decision.reason,
        message: decision.message,
        citation: decision.citation,
        outlet: decision.outlet,
      });
    }
    return this.fail(actor, actorCode, orgUnitId, caseId, opcode, {
      reason: 'advisory',
      message: decision.message,
      citation: decision.citation,
      outlet: '该提示不改变案件',
      httpStatus: 200,
      result: 'advisory',
    });
  }

  private async fail(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    caseId: string,
    opcode: string,
    fail: {
      readonly reason: string;
      readonly message: string;
      readonly citation: string | null;
      readonly outlet: string;
      readonly httpStatus?: 200 | 409;
      readonly result?: string;
    },
  ): Promise<CaseStateHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'advisory') as CaseTransitionedFailedReason;
    const status = fail.httpStatus ?? 409;
    const outcome: CaseStateHttpOutcome =
      status === 200
        ? {
            status: 200,
            body: {
              result: fail.result ?? 'advisory',
              reason: fail.reason,
              message: fail.message,
              basis: fail.citation,
            },
          }
        : blockBody(fail.reason, fail.message, fail.citation, fail.outlet);
    return this.uow.run(async () =>
      rejected(outcome, {
        action: 'case.transitioned',
        outcome: 'failed',
        reason,
        ...this.parties(actor, actorCode, orgUnitId, caseId, opcode),
      }),
    );
  }

  private async authorize(
    actor: ActorRef,
    opcode: string,
    targetOrgId: string,
    caseId: string,
  ): Promise<string | null> {
    try {
      await this.access.authorize(actor, opcode, targetOrgId, { resourceType: 'case', resourceId: caseId });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return error.reason;
    }
  }

  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    caseId: string,
    opcode: string,
  ) {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'case' as const,
      resourceId: caseId,
    };
  }
}

function blockBody(
  reason: string,
  message: string,
  citation: string | null,
  outlet: string,
): CaseStateHttpOutcome {
  return {
    status: 409,
    body: { result: reason, reason, message, basis: citation, outlet },
  };
}

function presentCase(view: CaseView): Record<string, unknown> {
  const statusName = CASE_MAIN_STATUS_NAMES[view.status as CaseMainStatus] ?? view.status;
  const stageName = CASE_STAGE_NAMES[view.currentStage as keyof typeof CASE_STAGE_NAMES] ?? view.currentStage;
  return {
    id: view.id,
    handlingOrgId: view.handlingOrgId,
    status: view.status,
    statusName,
    currentStage: view.currentStage,
    stageName,
    stageEntrySeq: view.stageEntrySeq,
    instances: view.instances.map((row) => ({
      id: row.id,
      stage: row.stage,
      stageName: CASE_STAGE_NAMES[row.stage as keyof typeof CASE_STAGE_NAMES] ?? row.stage,
      entrySeq: row.entrySeq,
      status: row.status,
      statusName: CASE_INSTANCE_STATUS_NAMES[row.status as keyof typeof CASE_INSTANCE_STATUS_NAMES] ?? row.status,
      enteredAt: row.enteredAt.toISOString(),
      transitionCode: row.transitionCode,
    })),
    history: view.history.map((row) => ({
      id: row.id,
      transitionCode: row.transitionCode,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
