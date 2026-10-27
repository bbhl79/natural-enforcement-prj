// 人员层利害关系与回避（#237）。
// 过渡：登记声明、调查继续登记复用 doc.draft；回避决定复用 doc.approve。不新增操作码。
// 正式码（草案 case.conflict.mark）待 #230／#71 回写后迁入。
// 决定人两级：过渡映射，待岗位模型能区分两级负责人后替换。
// 替换点只有 transitionalDeciderSeats。本文件只取人员事实。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  type CaseConflictDecidedFailedReason,
  type CaseConflictDeclaredFailedReason,
  type CaseInvestigationRecordedFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CONFLICT_SOURCE_NAMES,
  CONFLICT_STATUS_NAMES,
  DECISION_CONCLUSION_NAMES,
  INVESTIGATION_KIND_NAMES,
  SIGN_REFUSED_MESSAGE,
  SIGN_REFUSED_OUTLET,
  activeConflicts,
  deciderSeatMatches,
  excludeConflictedCandidates,
  isConflictSource,
  isDecisionConclusion,
  isInvestigationKind,
  isSignKind,
  latestConflictEvents,
  statusAfterDecision,
  transitionalDeciderSeats,
  type CaseStore,
  type ConflictEventFact,
  type ConflictSource,
  type PersonConflictEventRow,
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
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

/** 过渡操作码。登记声明与调查继续登记。 */
const DECLARE_OPCODE = 'doc.draft';
/** 过渡操作码。回避决定。 */
const DECIDE_OPCODE = 'doc.approve';
const READ_OPCODE = 'case.read';

const HANDLER_ROLES = new Set(['main', 'assist']);

export type ConflictHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly reason: string } }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: {
        readonly result: string;
        readonly reason: string;
        readonly outlet?: string;
        readonly message?: string;
      };
    };

@Injectable()
export class CaseConflictService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  /** 该人在本案的声明与生效记录。 */
  async activeConflicts(caseId: string, personId: string): Promise<ConflictEventFact[]> {
    const events = await this.cases.listPersonConflictEvents(caseId, personId);
    return activeConflicts(events.map(toFact), personId);
  }

  /**
   * 签出守卫。签出类型为审理意见、法审意见或决定。
   * 命中声明或生效即 409，写一行失败留痕，出路为等待回避决定。
   * 调用方自行完成签出操作码授权。本方法不另造操作码。
   */
  async assertCanSign(
    actor: ActorRef,
    caseId: string,
    personId: string,
    signKind: string,
  ): Promise<ConflictHttpOutcome> {
    if (!isSignKind(signKind)) {
      return { status: 400, body: { result: 'non-compliant', reason: 'invalid-sign-kind' } };
    }
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const events = await this.cases.listPersonConflictEvents(caseId, personId);
    const active = activeConflicts(events.map(toFact), personId);
    if (active.length === 0) {
      return { status: 200, body: { result: 'sign-allowed', caseId, personId, signKind } };
    }
    const account = await this.directory.findById(actor.personnelId);
    const subject = await this.directory.findById(personId);
    return this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'case.sign-refused',
        reason: 'conflict-active',
        ...this.parties(actor, account, view.handlingOrgId, caseId, null, personId, subject?.code ?? null),
        detail: JSON.stringify({
          message: SIGN_REFUSED_MESSAGE,
          outlet: SIGN_REFUSED_OUTLET,
          signKind,
          status: active[0]?.status ?? null,
        }),
      });
      return {
        status: 409 as const,
        body: {
          result: 'sign-refused',
          reason: 'conflict-active',
          outlet: SIGN_REFUSED_OUTLET,
          message: SIGN_REFUSED_MESSAGE,
        },
      };
    });
  }

  async list(actor: ActorRef, caseId: string): Promise<ConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const auth = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    const events = await this.cases.listPersonConflictEvents(caseId);
    const decisions = await this.cases.listPersonConflictDecisions(caseId);
    const facts = events.map(toFact);
    return {
      status: 200,
      body: {
        result: 'conflicts',
        caseId,
        records: facts.map(presentEvent),
        decisions: decisions.map((row) => ({
          id: row.id,
          lineageId: row.lineageId,
          deciderId: row.deciderId,
          conclusion: row.conclusion,
          conclusionName: DECISION_CONCLUSION_NAMES[row.conclusion as keyof typeof DECISION_CONCLUSION_NAMES] ?? row.conclusion,
          reason: row.reason,
          decidedAt: row.decidedAt.toISOString(),
        })),
        active: activeConflicts(facts).map(presentEvent),
      },
    };
  }

  async declare(
    actor: ActorRef,
    caseId: string,
    input: { readonly personId: string; readonly source: string; readonly reason: string },
  ): Promise<ConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const auth = await this.authorize(actor, DECLARE_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    if (!this.isHandler(view.handlers, actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (!isConflictSource(input.source)) {
      return this.failDeclare(actor, account, view.handlingOrgId, caseId, 'invalid-source');
    }
    const reason = input.reason.trim();
    if (reason === '') {
      return this.failDeclare(actor, account, view.handlingOrgId, caseId, 'missing-reason');
    }
    if (input.source === 'self' && input.personId !== actor.personnelId) {
      return this.failDeclare(actor, account, view.handlingOrgId, caseId, 'self-mismatch');
    }
    const subject = await this.directory.findById(input.personId);
    if (!subject) {
      return this.failDeclare(actor, account, view.handlingOrgId, caseId, 'unknown-person');
    }
    const source: ConflictSource = input.source;
    const at = this.clock.now();
    const id = newUlid();
    return this.uow.run(async (tx) => {
      const existing = await tx.cases.listPersonConflictEvents(caseId, input.personId);
      if (activeConflicts(existing.map(toFact), input.personId).length > 0) {
        return rejected<ConflictHttpOutcome>(
          { status: 409, body: { result: 'conflict-pending', reason: 'conflict-pending' } },
          {
            action: 'case.conflict-declared',
            outcome: 'failed',
            reason: 'conflict-pending',
            ...this.parties(actor, account, view.handlingOrgId, caseId, DECLARE_OPCODE, input.personId, subject.code),
          },
        );
      }
      await tx.cases.appendPersonConflictEvent({
        id,
        caseId,
        personId: input.personId,
        lineageId: id,
        source,
        reason,
        status: 'declared',
        seq: 1,
        createdBy: actor.personnelId,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'case.conflict-declared',
        ...this.parties(actor, account, view.handlingOrgId, caseId, DECLARE_OPCODE, input.personId, subject.code),
        detail: JSON.stringify({ lineageId: id, source, status: 'declared' }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'conflict-declared',
          caseId,
          lineageId: id,
          personId: input.personId,
          source,
          sourceName: CONFLICT_SOURCE_NAMES[source],
          status: 'declared',
          statusName: CONFLICT_STATUS_NAMES.declared,
        },
      };
    });
  }

  async decide(
    actor: ActorRef,
    caseId: string,
    lineageId: string,
    input: { readonly conclusion: string; readonly reason: string },
  ): Promise<ConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const auth = await this.authorize(actor, DECIDE_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    if (!isDecisionConclusion(input.conclusion)) {
      return this.failDecide(actor, account, view.handlingOrgId, caseId, 'invalid-conclusion');
    }
    const conclusion = input.conclusion;
    const reason = input.reason.trim();
    if (reason === '') {
      return this.failDecide(actor, account, view.handlingOrgId, caseId, 'missing-reason');
    }
    const events = await this.cases.listPersonConflictEvents(caseId);
    const latest = latestConflictEvents(events.map(toFact)).find((row) => row.lineageId === lineageId);
    if (!latest) return { status: 404, body: { result: 'not-found' } };
    if (latest.status !== 'declared') {
      return this.failDecide(actor, account, view.handlingOrgId, caseId, 'invalid-state');
    }
    if (!isConflictSource(latest.source)) {
      return this.failDecide(actor, account, view.handlingOrgId, caseId, 'invalid-state');
    }
    const subjectSeats = await this.seatsOf(latest.personId, view.handlingOrgId);
    const deciderSeats = await this.seatsOf(actor.personnelId, view.handlingOrgId);
    if (!deciderSeatMatches({
      source: latest.source,
      subjectIsHandlingOrgHead: subjectSeats.isHandlingOrgHead,
      deciderIsHandlingOrgHead: deciderSeats.isHandlingOrgHead,
      deciderIsCompetentAuthorityHead: deciderSeats.isCompetentAuthorityHead,
    })) {
      return this.failDecide(actor, account, view.handlingOrgId, caseId, 'decider-mismatch');
    }
    const subject = await this.directory.findById(latest.personId);
    const at = this.clock.now();
    const decisionId = newUlid();
    const nextId = newUlid();
    const nextStatus = statusAfterDecision(conclusion);
    return this.uow.run(async (tx) => {
      const ok = await tx.cases.appendPersonConflictDecision({
        id: decisionId,
        caseId,
        lineageId,
        deciderId: actor.personnelId,
        conclusion: input.conclusion,
        reason,
        decidedAt: at,
        nextEvent: {
          id: nextId,
          caseId,
          personId: latest.personId,
          lineageId,
          source: latest.source,
          reason: latest.reason,
          status: nextStatus,
          seq: latest.seq + 1,
          createdBy: actor.personnelId,
          createdAt: at,
        },
      });
      if (!ok) {
        return rejected<ConflictHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.conflict-decided',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, account, view.handlingOrgId, caseId, DECIDE_OPCODE, latest.personId, subject?.code ?? null),
          },
        );
      }
      await tx.audit.append({
        action: 'case.conflict-decided',
        ...this.parties(actor, account, view.handlingOrgId, caseId, DECIDE_OPCODE, latest.personId, subject?.code ?? null),
        previousValue: 'declared',
        detail: JSON.stringify({
          lineageId,
          conclusion,
          status: nextStatus,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'conflict-decided',
          caseId,
          lineageId,
          decisionId,
          conclusion,
          conclusionName: DECISION_CONCLUSION_NAMES[conclusion],
          status: nextStatus,
          statusName: CONFLICT_STATUS_NAMES[nextStatus],
        },
      };
    });
  }

  /** 承办人员在声明期间继续登记笔录或违法记录。不调用签出守卫。 */
  async recordInvestigation(
    actor: ActorRef,
    caseId: string,
    input: { readonly kind: string; readonly summary: string },
  ): Promise<ConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const auth = await this.authorize(actor, DECLARE_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    if (!this.isHandler(view.handlers, actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (!isInvestigationKind(input.kind)) {
      return this.failInvestigation(actor, account, view.handlingOrgId, caseId, 'invalid-kind');
    }
    const kind = input.kind;
    const summary = input.summary.trim();
    if (summary === '') {
      return this.failInvestigation(actor, account, view.handlingOrgId, caseId, 'missing-summary');
    }
    const at = this.clock.now();
    const id = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.appendInvestigationEntry({
        id,
        caseId,
        personnelId: actor.personnelId,
        kind,
        summary,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'case.investigation-recorded',
        ...this.parties(actor, account, view.handlingOrgId, caseId, DECLARE_OPCODE, actor.personnelId, account?.code ?? null),
        detail: JSON.stringify({ entryId: id, kind }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'investigation-recorded',
          caseId,
          entryId: id,
          kind,
          kindName: INVESTIGATION_KIND_NAMES[kind],
        },
      };
    });
  }

  /** 法审接收人候选：排除有声明或生效记录的人。 */
  async filterLegalReviewCandidates(
    actor: ActorRef,
    caseId: string,
    personIds: readonly string[],
  ): Promise<ConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const auth = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    const events = await this.cases.listPersonConflictEvents(caseId);
    return {
      status: 200,
      body: {
        result: 'legal-review-candidates',
        caseId,
        personIds: excludeConflictedCandidates(personIds, events.map(toFact)),
      },
    };
  }

  /** 只取人员事实。过渡映射，待岗位模型能区分两级负责人后替换。替换点只有 transitionalDeciderSeats。 */
  private async seatsOf(personId: string, handlingOrgId: string): Promise<{
    readonly isHandlingOrgHead: boolean;
    readonly isCompetentAuthorityHead: boolean;
  }> {
    const account = await this.directory.findById(personId);
    const orgUnitId = account?.orgUnitId ?? null;
    const orgPathToRoot = orgUnitId == null ? [] : await this.identity.findOrgUnitPathToRoot(handlingOrgId);
    return transitionalDeciderSeats({
      roles: account?.roles ?? [],
      orgUnitId,
      handlingOrgId,
      orgPathToRoot,
    });
  }

  private isHandler(
    handlers: readonly { readonly personnelId: string; readonly role: string }[],
    personnelId: string,
  ): boolean {
    return handlers.some((handler) => handler.personnelId === personnelId && HANDLER_ROLES.has(handler.role));
  }

  private async authorize(
    actor: ActorRef,
    opcode: string,
    targetOrgId: string,
    caseId: string,
  ): Promise<ConflictHttpOutcome | null> {
    try {
      await this.access.authorize(actor, opcode, targetOrgId, { resourceType: 'case', resourceId: caseId });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
  }

  private parties(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    opcode: string | null,
    subjectPersonnelId: string | null,
    subjectCode: string | null,
  ) {
    return {
      actorId: actor.personnelId,
      actorCode: account?.code ?? null,
      subjectPersonnelId,
      subjectCode,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'case' as const,
      resourceId: caseId,
    };
  }

  private failDeclare(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    reason: CaseConflictDeclaredFailedReason,
  ): Promise<ConflictHttpOutcome> {
    const outcome: ConflictHttpOutcome = reason === 'conflict-pending'
      ? { status: 409, body: { result: 'conflict-pending', reason: 'conflict-pending' } }
      : { status: 400, body: { result: 'non-compliant', reason } };
    return this.uow.run(async () => rejected(outcome, {
      action: 'case.conflict-declared',
      outcome: 'failed',
      reason,
      ...this.parties(actor, account, orgUnitId, caseId, DECLARE_OPCODE, null, null),
    }));
  }

  private failDecide(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    reason: CaseConflictDecidedFailedReason,
  ): Promise<ConflictHttpOutcome> {
    const outcome: ConflictHttpOutcome = reason === 'missing-reason' || reason === 'invalid-conclusion'
      ? { status: 400, body: { result: 'non-compliant', reason } }
      : { status: 409, body: { result: reason, reason } };
    return this.uow.run(async () => rejected(outcome, {
      action: 'case.conflict-decided',
      outcome: 'failed',
      reason,
      ...this.parties(actor, account, orgUnitId, caseId, DECIDE_OPCODE, null, null),
    }));
  }

  private failInvestigation(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    reason: CaseInvestigationRecordedFailedReason,
  ): Promise<ConflictHttpOutcome> {
    return this.uow.run(async () => rejected<ConflictHttpOutcome>(
      { status: 400, body: { result: 'non-compliant', reason } },
      {
        action: 'case.investigation-recorded',
        outcome: 'failed',
        reason,
        ...this.parties(actor, account, orgUnitId, caseId, DECLARE_OPCODE, null, null),
      },
    ));
  }
}

function toFact(row: PersonConflictEventRow): ConflictEventFact {
  return {
    id: row.id,
    lineageId: row.lineageId,
    caseId: row.caseId,
    personId: row.personId,
    source: row.source,
    reason: row.reason,
    status: row.status,
    seq: row.seq,
    createdAt: row.createdAt,
  };
}

function presentEvent(event: ConflictEventFact): Record<string, unknown> {
  const sourceName = isConflictSource(event.source) ? CONFLICT_SOURCE_NAMES[event.source] : event.source;
  const statusName = event.status in CONFLICT_STATUS_NAMES
    ? CONFLICT_STATUS_NAMES[event.status as keyof typeof CONFLICT_STATUS_NAMES]
    : event.status;
  return {
    id: event.id,
    lineageId: event.lineageId,
    personId: event.personId,
    source: event.source,
    sourceName,
    reason: event.reason,
    status: event.status,
    statusName,
    seq: event.seq,
    createdAt: event.createdAt.toISOString(),
  };
}
