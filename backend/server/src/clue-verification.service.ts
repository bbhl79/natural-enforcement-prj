// 内业核查编排（#213；规格 C 节、USER LOCK L2）。
//
// 编排只做四件事：起运行行并入队、执行一次核查、收尾落库、回答界面与手动重跑。
// 空间套合与图层服务调用都在核查执行端口之后（可注入），本文件不碰图层服务。
//
// 口径：
// - 范围：只有土地与矿产跑核查；测绘与规划不跑，只显示「不设内业核查」。录入保存成功后自动入队，不可跳过。
// - 自动核查：总尝试次数 4（首次加自动重试 3 次），重试延迟 30／60／120 秒。自动重试属同一运行。
// - 手动重跑：每次创建新运行，只执行 1 次，不自动重跑。权限＝录入人∪本单位内勤∪当前承办人。
// - 失败分类：某层查不成（未配置服务地址、服务不可用、超时、返回不合规）属确定性失败，不重试，
//   当次即判没跑成，缺图层落位，不生成成功报告；端口抛出的未预期故障属瞬时失败，重试至多 3 次。
// - 核查状态是线索的正交属性：任何核查状态都不关分派入口。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueVerifyRetryFailedReason,
} from '@natural-enforcement/audit';
import {
  AUTO_VERIFICATION_ATTEMPTS,
  AUTO_VERIFICATION_BACKOFF,
  CLUE_STORE,
  CLUE_VERIFICATION_PORT,
  ClueVerificationRunningError,
  MANUAL_VERIFICATION_ATTEMPTS,
  VERIFICATION_STATUS_LABELS,
  buildVerificationAnalysis,
  buildVerificationReport,
  isTerminalClueStatus,
  requiresVerification,
  spatialVersionOf,
  verificationReportText,
  type ClueStore,
  type ClueVerificationContext,
  type ClueVerificationPort,
  type ClueVerificationRunRow,
  type VerificationLayerResult,
  type VerificationOutcome,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
} from '@natural-enforcement/identity';
import { NonRetryableError, QUEUE_PORT, type QueuePort } from '@natural-enforcement/queue';
import { STORAGE_PORT, type StoragePort } from '@natural-enforcement/storage';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { QuarantinedObjectError, StorageQuarantineService } from './storage-quarantine.service.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const RETRY_OPCODE = 'clue.verify.retry';
const READ_OPCODE = 'clue.read';

/** 内业核查任务名。业务 worker 自带，不占 system. 命名空间。 */
export const VERIFICATION_JOB = 'clue.verification';

/** 任务载荷。 */
export interface VerificationJobPayload {
  readonly runId: string;
  readonly clueId: string;
}

/** 一次运行的界面形状。 */
export interface ClueVerificationRunView {
  readonly id: string;
  readonly runNo: number;
  readonly status: string;
  readonly statusLabel: string;
  readonly trigger: string;
  readonly attemptsUsed: number;
  readonly failureCategory: string | null;
  readonly missingLayers: readonly { readonly key: string; readonly name: string }[];
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly layers: readonly ClueVerificationLayerView[];
}

/** 一层的事实（界面形状）。 */
export interface ClueVerificationLayerView {
  readonly layerKey: string;
  readonly layerName: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly totalArea: number;
  readonly overlapArea: number;
  readonly outsideArea: number;
  readonly overlapRatio: number;
  readonly featureCount: number;
  readonly serviceUrl: string | null;
  readonly queriedAt: string | null;
  readonly unavailableReason: string | null;
}

/** 核查视图（当前状态与历史运行）。 */
export interface ClueVerificationView {
  readonly result: 'listed';
  readonly clueId: string;
  readonly code: string;
  readonly domain: string;
  /** 该法域是否设内业核查。 */
  readonly required: boolean;
  /** 线索的核查状态：not_required｜running｜done｜failed。 */
  readonly verificationStatus: string;
  readonly verificationStatusLabel: string;
  /** 线索主状态（终态线索不再允许手动重跑）。 */
  readonly clueStatus: string;
  /** 当前操作者能否手动重跑。 */
  readonly canRetry: boolean;
  /** 不能重跑的原因（连字符小写）；能重跑即 null。 */
  readonly retryBlockedReason: string | null;
  /** 当前运行（最近一次）。 */
  readonly current: ClueVerificationRunView | null;
  /** 历史运行（序号倒序）。 */
  readonly runs: readonly ClueVerificationRunView[];
  /** 产物引用（报告与分析图）。没跑成即 null。 */
  readonly artifacts: {
    readonly report: { readonly fileKey: string; readonly versionId: string };
    readonly analysis: { readonly fileKey: string; readonly versionId: string };
  } | null;
}

export type ClueVerificationOutcome =
  | { readonly status: 200; readonly body: ClueVerificationView }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | {
      readonly status: 409;
      readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string };
    };

/** 手动重跑被拒（outcome=failed）的原因。 */
interface RetryRejection {
  readonly result: 'invalid-state' | 'concurrent-change';
  readonly reason: ClueVerifyRetryFailedReason;
}

@Injectable()
export class ClueVerificationService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(CLUE_VERIFICATION_PORT) private readonly port: ClueVerificationPort,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
    private readonly quarantine: StorageQuarantineService,
  ) {}

  /**
   * 登记保存成功后自动入队（不可跳过）。
   * 点状与规划类不跑核查，直接返回。投递失败时把运行置为没跑成（瞬时），
   * 界面挂重跑提示，等有权人手动重跑。
   */
  async scheduleAutomatic(clueId: string): Promise<void> {
    const context = await this.clues.readVerificationContext(clueId);
    if (!context || !requiresVerification(context.domain)) return;
    const run = await this.startRun(clueId, 'auto');
    if (run === null) return;
    try {
      await this.queue.enqueue(
        VERIFICATION_JOB,
        { runId: run.id, clueId } satisfies VerificationJobPayload,
        { attempts: AUTO_VERIFICATION_ATTEMPTS, backoff: AUTO_VERIFICATION_BACKOFF },
      );
    } catch (error) {
      // 投递失败属瞬时故障：运行置没跑成，提示继续挂着，可手动重跑。
      await this.finish(run.id, {
        status: 'failed',
        attemptsUsed: 0,
        failureCategory: 'transient',
        missingLayers: [],
        layers: [],
        artifacts: null,
      });
      throw error;
    }
  }

  /** 手动重跑：每次创建新运行，只执行 1 次，不自动重试。 */
  async retry(actor: ActorRef, clueId: string): Promise<ClueVerificationOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const context = await this.clues.readVerificationContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };

    // 授权第一层：操作码（角色 × 操作码）。拒绝时 authorize 自己写 authz.denied 留痕。
    try {
      await this.access.authorize(actor, RETRY_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（录入人∪本单位内勤∪当前承办人）。
    if (!(await this.mayRetry(actor, context, account))) {
      await this.denyRetry(actor, account?.code ?? null, actorOrgId, context);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (!requiresVerification(context.domain)) {
      return this.rejectRetry(actor, account?.code ?? null, actorOrgId, clueId, {
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    if (isTerminalClueStatus(context.status)) {
      return this.rejectRetry(actor, account?.code ?? null, actorOrgId, clueId, {
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }

    // 起新运行：运行行与成功留痕同成同败。
    const runNo = await this.clues.nextVerificationRunNo(clueId);
    const runId = newUlid();
    try {
      await this.uow.run(async (tx) => {
        await tx.clues.insertVerificationRun({
          id: runId,
          clueId,
          runNo,
          trigger: 'manual',
          startedAt: new Date(),
        });
        await tx.audit.append({
          action: 'clue.verify-retried',
          ...this.parties(actor, account?.code ?? null, actorOrgId, clueId),
          detail: JSON.stringify({ code: context.code, runNo }),
        });
      });
    } catch (error) {
      // 每条线索至多一个活动核查：并发手动重跑即 409。
      if (error instanceof ClueVerificationRunningError) {
        return this.rejectRetry(actor, account?.code ?? null, actorOrgId, clueId, {
          result: 'concurrent-change',
          reason: 'concurrent-change',
        });
      }
      throw error;
    }
    await this.queue.enqueue(
      VERIFICATION_JOB,
      { runId, clueId } satisfies VerificationJobPayload,
      { attempts: MANUAL_VERIFICATION_ATTEMPTS },
    );
    const runs = await this.clues.listVerificationRuns(clueId);
    return { status: 200, body: await this.buildView(actor, context, account, runs) };
  }

  /**
   * 执行一次核查（worker 处理器调它）。
   * attempt 是本次是第几次尝试（首次为 1）。
   */
  async execute(payload: VerificationJobPayload, attempt: number): Promise<void> {
    const run = await this.clues.readVerificationRun(payload.runId);
    if (run === null || run.status !== 'running') return;
    const context = await this.clues.readVerificationContext(payload.clueId);
    if (context === null) return;

    const parts = context.parts.map((part) => ({
      partId: part.partId,
      partIndex: part.partIndex,
      geojson: part.geojson,
    }));
    const spatialVersion = spatialVersionOf(parts);
    let outcome: VerificationOutcome;
    try {
      outcome = await this.port.run({
        clueId: context.clueId,
        domain: context.domain,
        spatialVersion,
        totalArea: context.totalArea,
        parts,
      });
    } catch (error) {
      // 端口抛出的未预期故障属瞬时失败：自动核查重试至多 3 次；手动重跑不重试。
      const maxAttempts = run.trigger === 'auto' ? AUTO_VERIFICATION_ATTEMPTS : MANUAL_VERIFICATION_ATTEMPTS;
      await this.clues.recordVerificationAttempt(run.id, attempt);
      if (attempt >= maxAttempts) {
        await this.finish(run.id, {
          status: 'failed',
          attemptsUsed: attempt,
          failureCategory: 'transient',
          missingLayers: [],
          layers: [],
          artifacts: null,
        });
      }
      throw error;
    }

    const unavailable = outcome.layers.filter((layer) => layer.state === 'unavailable');
    if (unavailable.length > 0) {
      // 确定性失败：不重试，当次即判没跑成，缺图层落位，不生成成功报告。
      await this.finish(run.id, {
        status: 'failed',
        attemptsUsed: attempt,
        failureCategory: 'deterministic',
        missingLayers: unavailable.map((layer) => layer.layerKey),
        layers: outcome.layers,
        artifacts: null,
      });
      throw new NonRetryableError(
        'missing-layers',
        `缺图层：${unavailable.map((layer) => layer.layerKey).join('、')}`,
      );
    }

    const reportInput = {
      clueId: context.clueId,
      clueCode: context.code,
      domain: context.domain,
      runId: run.id,
      runNo: run.runNo,
      trigger: run.trigger,
      startedAt: run.startedAt.toISOString(),
      spatialVersion,
      totalArea: context.totalArea,
      parts,
      layers: outcome.layers,
    };
    const report = buildVerificationReport(reportInput);
    const analysis = buildVerificationAnalysis(reportInput);
    const reportRef = await this.storage.putVersion(
      `clue/${context.clueId}/verification/${run.id}/report.json`,
      new TextEncoder().encode(verificationReportText(report)),
    );
    const analysisRef = await this.storage.putVersion(
      `clue/${context.clueId}/verification/${run.id}/analysis.geojson`,
      new TextEncoder().encode(analysis),
    );
    await this.finish(run.id, {
      status: 'done',
      attemptsUsed: attempt,
      failureCategory: null,
      missingLayers: [],
      layers: outcome.layers,
      artifacts: { report: reportRef, analysis: analysisRef },
    });
  }

  /** 读线索的核查视图：当前状态、历史运行与产物引用。 */
  async read(actor: ActorRef, clueId: string): Promise<ClueVerificationOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const context = await this.clues.readVerificationContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    try {
      await this.access.authorize(actor, READ_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const runs = await this.clues.listVerificationRuns(clueId);
    return { status: 200, body: await this.buildView(actor, context, account, runs) };
  }

  /** 组装核查视图：当前状态、历史运行与产物引用。 */
  private async buildView(
    actor: ActorRef,
    context: ClueVerificationContext,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    runs: readonly ClueVerificationRunRow[],
  ): Promise<ClueVerificationView> {
    const required = requiresVerification(context.domain);
    const current = runs[0] ?? null;
    // 没有活动运行又没有结果时，状态即「没跑成」：重跑提示挂到跑成。
    const status = current?.status ?? (required ? 'failed' : 'not_required');
    const blocked = await this.retryBlockedReason(actor, context, account, required, current);
    return {
      result: 'listed',
      clueId: context.clueId,
      code: context.code,
      domain: context.domain,
      required,
      verificationStatus: status,
      verificationStatusLabel: VERIFICATION_STATUS_LABELS[statusKey(status)],
      clueStatus: context.status,
      canRetry: blocked === null,
      retryBlockedReason: blocked,
      current: current === null ? null : toRunView(current),
      runs: runs.map(toRunView),
      artifacts: current?.artifacts ?? null,
    };
  }

  /** 读产物内容（报告或分析图）。 */
  async readArtifact(
    actor: ActorRef,
    clueId: string,
    kind: 'report' | 'analysis',
  ): Promise<
    | { readonly status: 200; readonly body: Uint8Array; readonly contentType: string }
    | { readonly status: 403; readonly body: { readonly reason: DenyReason | 'object-quarantined' } }
    | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  > {
    const context = await this.clues.readVerificationContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    try {
      await this.access.authorize(actor, READ_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const runs = await this.clues.listVerificationRuns(clueId);
    const done = runs.find((run) => run.status === 'done' && run.artifacts !== null);
    if (done === undefined || done.artifacts === null) {
      return { status: 404, body: { result: 'not-found' } };
    }
    const ref = kind === 'report' ? done.artifacts.report : done.artifacts.analysis;
    try {
      await this.quarantine.assertReadable(ref);
    } catch (error) {
      if (error instanceof QuarantinedObjectError) {
        return { status: 403, body: { reason: 'object-quarantined' } };
      }
      throw error;
    }
    const content = await this.storage.readVersion(ref);
    return {
      status: 200,
      body: content,
      contentType: kind === 'report' ? 'application/json; charset=utf-8' : 'application/geo+json; charset=utf-8',
    };
  }

  /** 起一次运行：写运行行并把线索的核查状态置为进行中。已有活动核查即 null。 */
  private async startRun(
    clueId: string,
    trigger: 'auto' | 'manual',
  ): Promise<{ readonly id: string } | null> {
    const runNo = await this.clues.nextVerificationRunNo(clueId);
    const id = newUlid();
    try {
      await this.uow.run(async (tx) => {
        await tx.clues.insertVerificationRun({ id, clueId, runNo, trigger, startedAt: new Date() });
      });
    } catch (error) {
      if (error instanceof ClueVerificationRunningError) return null;
      throw error;
    }
    return { id };
  }

  /** 收尾一次运行：运行行与线索核查状态同一事务写。 */
  private async finish(
    runId: string,
    write: {
      readonly status: 'done' | 'failed';
      readonly attemptsUsed: number;
      readonly failureCategory: 'transient' | 'deterministic' | null;
      readonly missingLayers: readonly string[];
      readonly layers: readonly VerificationLayerResult[];
      readonly artifacts: {
        readonly report: { readonly fileKey: string; readonly versionId: string };
        readonly analysis: { readonly fileKey: string; readonly versionId: string };
      } | null;
    },
  ): Promise<void> {
    await this.uow.run(async (tx) =>
      tx.clues.finishVerificationRun({ runId, endedAt: new Date(), ...write }),
    );
  }

  /** 对象级权限：录入人 ∪ 本单位内勤 ∪ 当前承办人。 */
  private async mayRetry(
    actor: ActorRef,
    context: ClueVerificationContext,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
  ): Promise<boolean> {
    if (context.registeredBy === actor.personnelId) return true;
    if (
      account !== null &&
      account.orgUnitId !== null &&
      context.orgUnitIds.includes(account.orgUnitId) &&
      account.roles.includes('内勤')
    ) {
      return true;
    }
    const handlers = await this.clues.listActiveHandlers(context.clueId);
    return handlers.some((handler) => handler.personnelId === actor.personnelId);
  }

  /** 不能重跑的原因；能重跑即 null。 */
  private async retryBlockedReason(
    actor: ActorRef,
    context: ClueVerificationContext,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    required: boolean,
    current: ClueVerificationRunRow | null,
  ): Promise<string | null> {
    if (!required) return 'verification-not-required';
    if (isTerminalClueStatus(context.status)) return 'clue-terminal';
    if (current?.status === 'running') return 'verification-running';
    const decision = await this.access.check(actor, RETRY_OPCODE, context.enteredOrgId, {
      resourceType: 'clue',
      resourceId: context.clueId,
    });
    if (!decision.allowed) return 'permission-denied';
    if (!(await this.mayRetry(actor, context, account))) return 'permission-denied';
    return null;
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async denyRetry(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    context: ClueVerificationContext,
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
      opcode: RETRY_OPCODE,
      resourceType: 'clue',
      resourceId: context.clueId,
      previousValue: null,
      targetOrgUnitId: context.enteredOrgId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<ClueVerificationOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 拒绝类留痕：回滚后另起事务写入（#119 口径）。 */
  private async rejectRetry(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: RetryRejection,
  ): Promise<ClueVerificationOutcome> {
    const outcome: ClueVerificationOutcome = {
      status: 409,
      body: { result: rejection.result, reason: rejection.reason },
    };
    await this.uow.run(async () =>
      rejected<ClueVerificationOutcome>(outcome, {
        action: 'clue.verify-retried',
        outcome: 'failed',
        reason: rejection.reason,
        ...this.parties(actor, actorCode, orgUnitId, clueId),
      }),
    );
    return outcome;
  }

  /** 留痕的当事人列。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: RETRY_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}

/** 一次运行 → 界面形状。 */
function toRunView(run: ClueVerificationRunRow): ClueVerificationRunView {
  return {
    id: run.id,
    runNo: run.runNo,
    status: run.status,
    statusLabel: run.status === 'running' ? '核查进行中' : run.status === 'done' ? '已完成' : '没跑成',
    trigger: run.trigger,
    attemptsUsed: run.attemptsUsed,
    failureCategory: run.failureCategory,
    missingLayers: run.missingLayers.map((key) => ({ key, name: layerNameOf(key) })),
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt === null ? null : run.endedAt.toISOString(),
    layers: run.layers.map(toLayerView),
  };
}

/** 一层 → 界面形状。 */
function toLayerView(layer: VerificationLayerResult): ClueVerificationLayerView {
  const overlapArea = layer.features.reduce((sum, feature) => sum + feature.overlapArea, 0);
  const totalArea = layer.features.reduce((sum, feature) => sum + feature.featureArea, 0);
  return {
    layerKey: layer.layerKey,
    layerName: layer.layerName,
    state: layer.state,
    stateLabel:
      layer.state === 'overlapped' ? '有相交' : layer.state === 'no_overlap' ? '无相交' : '查不成',
    totalArea,
    overlapArea,
    outsideArea: Math.max(totalArea - overlapArea, 0),
    overlapRatio: totalArea > 0 ? overlapArea / totalArea : 0,
    featureCount: layer.features.length,
    serviceUrl: layer.serviceUrl,
    queriedAt: layer.queriedAt,
    unavailableReason: layer.unavailableReason,
  };
}

/** 图层键 → 中文名。名册外的键退回键本身。 */
function layerNameOf(key: string): string {
  return LAYER_NAMES.get(key) ?? key;
}

/** 图层键 → 中文名（图层目录的快照，供界面用）。 */
const LAYER_NAMES = new Map<string, string>([
  ['permanent-farmland', '永久基本农田'],
  ['ecological-redline', '生态保护红线'],
  ['urban-development-boundary', '城镇开发边界'],
  ['cultivated-land', '耕地'],
  ['land-conversion-approval', '农用地转用审批'],
  ['construction-land-permit', '建设用地规划许可'],
  ['land-supply-redline', '供地红线'],
  ['street-boundary', '街道镇边界'],
]);

/** 核查状态键（不在表内即 not_required）。 */
function statusKey(status: string): 'not_required' | 'running' | 'done' | 'failed' {
  if (status === 'running' || status === 'done' || status === 'failed') return status;
  return 'not_required';
}
