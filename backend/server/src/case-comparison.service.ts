// 新旧比对最小版（#271）。
// 过渡：判定随决定呈批材料提交，录入复用 doc.draft；提交检查由 #270 在决定呈批提交时调用；
// 批准检查由 #270 在决定书 doc.approve 时调用。不新增操作码，不接 T23。
// 判定只追加。批准失败写失败留痕，出路为重新比对。
// Q31 只返回 #258 警告，当天归属配置项不设默认，系统不据此自动判定。
// Q32 只提示，不阻断量罚。
// 比对结果只进内部材料和卷宗；本服务不向对外决定书输出。

import { Inject, Injectable } from '@nestjs/common';
import type { CaseComparisonFailedReason } from '@natural-enforcement/audit';
import {
  CASE_STORE,
  COMPARISON_STALE_MESSAGE,
  COMPARISON_STALE_OUTLET,
  assessComparisonFreshness,
  assessDecisionSubmission,
  beijingDateOf,
  isTerminalCaseStatus,
  q32Hints,
  readComparisonJudgment,
  type CaseStore,
  type CaseView,
  type ComparisonJudgmentRow,
  type ComparisonJudgmentWrite,
  type EffectiveDayAttribution,
  type RawComparisonJudgment,
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

/** 施行日当天归属配置项（#42 关票第二节）。默认不设归属。 */
export const COMPARISON_EFFECTIVE_DAY = Symbol('COMPARISON_EFFECTIVE_DAY');

/** 过渡操作码。判定录入复用拟制。 */
const DRAFT_OPCODE = 'doc.draft';
/** 决定呈批提交。由 #270 授权后调用本服务的检查函数。 */
const SUBMIT_OPCODE = 'doc.submit';
/** 决定书批准。由 #270 授权后调用本服务的检查函数。 */
const APPROVE_OPCODE = 'doc.approve';

export type ComparisonHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: Record<string, unknown> }
  | { readonly status: 404; readonly body: Record<string, unknown> }
  | { readonly status: 409; readonly body: Record<string, unknown> };

@Injectable()
export class CaseComparisonService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(COMPARISON_EFFECTIVE_DAY) private readonly effectiveDay: EffectiveDayAttribution,
    private readonly access: AccessControlService,
  ) {}

  /** 本案新旧比对判定（内部材料与卷宗用）。 */
  async read(caseId: string): Promise<ComparisonHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const rows = await this.cases.listComparisonJudgments(caseId);
    return {
      status: 200,
      body: { result: 'comparison', caseId, judgments: rows.map(presentJudgment) },
    };
  }

  /**
   * 录入一条判定。只追加；同一违法记录再录一行，最新一行生效。
   * 系统不判「较轻」，只校验材料完整。
   */
  async recordJudgment(actor: ActorRef, caseId: string, input: RawComparisonJudgment): Promise<ComparisonHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, DRAFT_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    if (!view.handlers.some((row) => row.personnelId === actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const account = await this.directory.findById(actor.personnelId);
    const at = this.clock.now();
    if (isTerminalCaseStatus(view.status)) {
      return this.failRecord(actor, account, view, at, '案件已终态，不能录入比对判定', 'invalid-state');
    }
    const read = readComparisonJudgment(input);
    if (!read.ok) {
      return this.failRecord(actor, account, view, at, read.message, read.reason);
    }
    const violations = await this.cases.listViolationRecords(caseId);
    const violation = violations.find(
      (row) => row.id === read.judgment.violationRecordId && row.status === 'active',
    );
    if (!violation) {
      return this.failRecord(actor, account, view, at, '违法记录不存在或已作废');
    }
    const write: ComparisonJudgmentWrite = {
      id: newUlid(),
      caseId,
      ...read.judgment,
      createdBy: actor.personnelId,
      createdAt: at,
    };
    const hints = q32Hints(read.judgment, beijingDateOf(at));
    return this.uow.run(async (tx) => {
      await tx.cases.insertComparisonJudgment(write);
      await tx.audit.append({
        action: 'case.comparison-recorded',
        ...this.parties(actor, account, view, DRAFT_OPCODE),
        detail: JSON.stringify({
          caseId,
          judgmentId: write.id,
          violationRecordId: write.violationRecordId,
          zeroDifference: write.zeroDifference,
          behaviorBasisCount: write.behaviorBases.length,
          decisionBasisCount: write.decisionBases.length,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'comparison-recorded',
          id: write.id,
          caseId,
          violationRecordId: write.violationRecordId,
          zeroDifference: write.zeroDifference,
          hints,
        },
      };
    });
  }

  /**
   * 决定呈批提交检查。每条有效违法记录都要有判定，缺一条即阻断。
   * 调查报告呈批不调用本函数。调用方在开启业务事务前调用本函数。
   */
  async assertComparisonComplete(caseId: string, actor?: ActorRef): Promise<ComparisonHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const [violations, judgments] = await Promise.all([
      this.cases.listViolationRecords(caseId),
      this.cases.listComparisonJudgments(caseId),
    ]);
    const activeViolationIds = violations.filter((row) => row.status === 'active').map((row) => row.id);
    const assessed = assessDecisionSubmission({ activeViolationIds, judgments });
    if (assessed.ok) {
      return { status: 200, body: { result: 'comparison-complete', caseId, violationCount: activeViolationIds.length } };
    }
    const account = actor ? await this.directory.findById(actor.personnelId) : null;
    return this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'case.comparison-refused',
        reason: 'missing-judgment',
        ...this.parties(actor ?? null, account, view, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId, missingViolationIds: assessed.missingViolationIds }),
      });
      return {
        status: 409 as const,
        body: {
          result: 'missing-judgment',
          reason: 'missing-judgment',
          message: assessed.message,
          outlet: assessed.outlet,
          missingViolationIds: assessed.missingViolationIds,
        },
      };
    });
  }

  /**
   * 批准时校验。批准时刻先换算成北京日期。
   * 判定所写的决定时版本与批准当日不一致，或没有人的判定与理由：409 比对过时，写失败留痕。
   * 批准日等于某依据条款施行日：返回 #258 警告，不以新／旧版判过时。
   * 调用方在开启业务事务前调用本函数（失败留痕自成事务）。
   */
  async assertComparisonFresh(
    caseId: string,
    approvedAt: Date,
    actor?: ActorRef,
  ): Promise<ComparisonHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const [violations, judgments] = await Promise.all([
      this.cases.listViolationRecords(caseId),
      this.cases.listComparisonJudgments(caseId),
    ]);
    const activeViolationIds = violations.filter((row) => row.status === 'active').map((row) => row.id);
    const assessed = assessComparisonFreshness({
      activeViolationIds,
      judgments,
      approvedAt,
      config: this.effectiveDay,
    });
    if (assessed.kind === 'stale') {
      const account = actor ? await this.directory.findById(actor.personnelId) : null;
      const reason: CaseComparisonFailedReason = assessed.reason;
      return this.uow.run(async (tx) => {
        await tx.audit.append({
          action: 'case.comparison-refused',
          reason,
          ...this.parties(actor ?? null, account, view, APPROVE_OPCODE),
          detail: JSON.stringify({
            caseId,
            approvedDay: assessed.approvedDay,
            missingViolationIds: assessed.missingViolationIds,
          }),
        });
        return {
          status: 409 as const,
          body: {
            result: 'comparison-stale',
            reason: assessed.reason,
            message: COMPARISON_STALE_MESSAGE,
            outlet: COMPARISON_STALE_OUTLET,
            approvedDay: assessed.approvedDay,
            missingViolationIds: assessed.missingViolationIds,
          },
        };
      });
    }
    if (assessed.kind === 'effective-day-warning') {
      return {
        status: 200,
        body: {
          result: 'warnings',
          warnings: [assessed.warning],
          hints: assessed.hints,
          outlet: assessed.outlet,
          approvedDay: assessed.approvedDay,
          clauses: assessed.clauses,
          effectiveDay: {
            ruleId: assessed.ruleId,
            version: this.effectiveDay.version,
            attribution: assessed.attribution,
          },
        },
      };
    }
    return {
      status: 200,
      body: {
        result: 'comparison-fresh',
        caseId,
        approvedDay: assessed.approvedDay,
        hints: assessed.hints,
      },
    };
  }

  private async failRecord(
    actor: ActorRef,
    account: LoginAccount | null,
    view: CaseView,
    at: Date,
    message: string,
    bodyReason = 'invalid-input',
  ): Promise<ComparisonHttpOutcome> {
    return this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'case.comparison-refused',
        reason: 'invalid-input',
        ...this.parties(actor, account, view, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId: view.id, at: at.toISOString(), message }),
      });
      return {
        status: 400 as const,
        body: { result: 'non-compliant' as const, reason: bodyReason, message, outlet: '补齐新旧比对判定材料' },
      };
    });
  }

  private async authorize(actor: ActorRef, opcode: string, targetOrgId: string, caseId: string): Promise<string | null> {
    try {
      await this.access.authorize(actor, opcode, targetOrgId, { resourceType: 'case', resourceId: caseId });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return error.reason;
    }
  }

  private parties(actor: ActorRef | null, account: LoginAccount | null, view: CaseView, opcode: string) {
    return {
      actorId: actor?.personnelId ?? null,
      actorCode: account?.code ?? null,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: view.handlingOrgId,
      sourceIp: null,
      opcode,
      resourceType: 'case' as const,
      resourceId: view.id,
    };
  }
}

function presentJudgment(row: ComparisonJudgmentRow): Record<string, unknown> {
  return {
    id: row.id,
    violationRecordId: row.violationRecordId,
    behaviorBases: row.behaviorBases,
    decisionBases: row.decisionBases,
    behaviorBenchmarks: row.behaviorBenchmarks,
    decisionBenchmarks: row.decisionBenchmarks,
    adoptedVersion: row.adoptedVersion,
    reason: row.reason,
    noticeRef: row.noticeRef,
    zeroDifference: row.zeroDifference,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}