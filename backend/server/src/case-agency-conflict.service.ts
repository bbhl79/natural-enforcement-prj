// 机关层利害关系提示（#263）。
// 过渡：勾选与取消尝试都复用 doc.draft。不新增操作码。
// 留痕复用 case.conflict-declared。detail.layer 为 agency。
// 只提示。本服务不调用签出守卫，也不改迁移或呈批。

import { Inject, Injectable } from '@nestjs/common';
import { rejected, type CaseConflictDeclaredFailedReason } from '@natural-enforcement/audit';
import {
  AGENCY_CONFLICT_ALREADY_MARKED_MESSAGE,
  AGENCY_CONFLICT_UNCHECK_MESSAGE,
  AGENCY_CONFLICT_WARNING,
  agencyConflictNotice,
  CASE_STORE,
  type AgencyConflictMark,
  type CaseStore,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  isAccessDenied,
  newUlid,
  type ActorRef,
} from '@natural-enforcement/identity';

import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

/** 过渡操作码。登记勾选。 */
const MARK_OPCODE = 'doc.draft';
const READ_OPCODE = 'case.read';

const HANDLER_ROLES = new Set(['main', 'assist']);

export type AgencyConflictHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly reason: string } }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: {
        readonly result: string;
        readonly reason: string;
        readonly message: string;
      };
    };

@Injectable()
export class CaseAgencyConflictService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<AgencyConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const auth = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    const marks = await this.cases.listAgencyConflictMarks(caseId);
    return { status: 200, body: this.present(caseId, marks) };
  }

  async setChecked(actor: ActorRef, caseId: string, checked: unknown): Promise<AgencyConflictHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const auth = await this.authorize(actor, MARK_OPCODE, view.handlingOrgId, caseId);
    if (auth) return auth;
    if (!this.isHandler(view.handlers, actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (checked !== true && checked !== false) {
      return this.fail(actor, account, view.handlingOrgId, caseId, 'invalid-checked');
    }
    const at = this.clock.now();
    const id = newUlid();
    return this.uow.run(async (tx) => {
      if (checked === false) {
        return this.rejectUncheck(actor, account, view.handlingOrgId, caseId);
      }
      const existing = await tx.cases.listAgencyConflictMarks(caseId);
      if (existing.length > 0) {
        return this.rejectAlreadyMarked(actor, account, view.handlingOrgId, caseId);
      }
      const ok = await tx.cases.appendAgencyConflictMark({
        id,
        caseId,
        orgUnitId: view.handlingOrgId,
        markedBy: actor.personnelId,
        createdAt: at,
      });
      if (!ok) return this.rejectAlreadyMarked(actor, account, view.handlingOrgId, caseId);
      await tx.audit.append({
        action: 'case.conflict-declared',
        ...this.parties(actor, account, view.handlingOrgId, caseId),
        detail: JSON.stringify({
          layer: 'agency',
          orgUnitId: view.handlingOrgId,
          warning: AGENCY_CONFLICT_WARNING,
        }),
      });
      const notice = agencyConflictNotice([{
        id,
        caseId,
        orgUnitId: view.handlingOrgId,
        markedBy: actor.personnelId,
        createdAt: at,
      }]);
      return {
        status: 200 as const,
        body: {
          result: 'agency-conflict-marked',
          caseId,
          ...notice,
          markedAt: at.toISOString(),
          markedBy: actor.personnelId,
        },
      };
    });
  }

  private present(caseId: string, marks: readonly AgencyConflictMark[]): Record<string, unknown> {
    const notice = agencyConflictNotice(marks);
    const row = marks[0];
    return {
      result: 'agency-conflict',
      caseId,
      ...notice,
      markedAt: row ? row.createdAt.toISOString() : null,
      markedBy: row?.markedBy ?? null,
      orgUnitId: row?.orgUnitId ?? null,
    };
  }

  private rejectUncheck(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
  ) {
    return rejected<AgencyConflictHttpOutcome>(
      {
        status: 409,
        body: {
          result: 'uncheck-forbidden',
          reason: 'uncheck-forbidden',
          message: AGENCY_CONFLICT_UNCHECK_MESSAGE,
        },
      },
      {
        action: 'case.conflict-declared',
        outcome: 'failed',
        reason: 'uncheck-forbidden',
        ...this.parties(actor, account, orgUnitId, caseId),
        detail: JSON.stringify({ layer: 'agency', attempt: 'uncheck', warning: AGENCY_CONFLICT_WARNING }),
      },
    );
  }

  private rejectAlreadyMarked(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
  ) {
    return rejected<AgencyConflictHttpOutcome>(
      {
        status: 409,
        body: {
          result: 'already-marked',
          reason: 'already-marked',
          message: AGENCY_CONFLICT_ALREADY_MARKED_MESSAGE,
        },
      },
      {
        action: 'case.conflict-declared',
        outcome: 'failed',
        reason: 'already-marked',
        ...this.parties(actor, account, orgUnitId, caseId),
        detail: JSON.stringify({ layer: 'agency', warning: AGENCY_CONFLICT_WARNING }),
      },
    );
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
  ): Promise<AgencyConflictHttpOutcome | null> {
    try {
      await this.access.authorize(actor, opcode, targetOrgId, { resourceType: 'case', resourceId: caseId });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
  }

  private parties(actor: ActorRef, account: LoginAccount | null, orgUnitId: string, caseId: string) {
    return {
      actorId: actor.personnelId,
      actorCode: account?.code ?? null,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: MARK_OPCODE,
      resourceType: 'case' as const,
      resourceId: caseId,
    };
  }

  private fail(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    reason: CaseConflictDeclaredFailedReason,
  ): Promise<AgencyConflictHttpOutcome> {
    return this.uow.run(async () => rejected<AgencyConflictHttpOutcome>(
      { status: 400, body: { result: 'non-compliant', reason } },
      {
        action: 'case.conflict-declared',
        outcome: 'failed',
        reason,
        ...this.parties(actor, account, orgUnitId, caseId),
        detail: JSON.stringify({ layer: 'agency' }),
      },
    ));
  }
}
