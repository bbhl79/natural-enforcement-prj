// 绘斑重绘与疑似重复重算（#212；规格 B「几何与疑似重复」）。
//
// 口径：
// - 重绘仅限录入人本人、线索在待分派决定／待分派池、未派机构且无活动核查。
// - 重绘生成新空间版本：旧部件整体换掉，面数与 dup_computed_at 同步更新。
// - 正式保存与重绘在写事务内同步重算：本线索命中集整体替换（零命中即清空），
//   原命中与新命中涉及的对方线索也分别完整重算（related-redraw，不递归）。
// - 命中替换的整体摘要（对方线索、面对、双方比例）写进触发动作的留痕 detail。
// - 重绘可能改变主状态：面状有命中进待分派决定，无命中与点状进待分派池。
//   对方线索被撞只更新疑似重复标记，主状态永远不动。
// - 土地／矿产重绘后重新内业核查（自动入队）；绘斑预览只读，不写正式命中。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueGeometryUpdateFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  requiresVerification,
  spatialVersionOf,
  parseSpatialSource,
  type ClueDuplicateContext,
  type ClueHitSummary,
  type ClueHitWrite,
  type ClueStore,
  type Domain,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
} from '@natural-enforcement/identity';

import { ClueVerificationService } from './clue-verification.service.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const GEOMETRY_OPCODE = 'clue.geometry.update';

/** 重绘请求（控制器已解析 JSON 正文）。 */
export interface ClueGeometryRequest {
  /** 输入坐标系（只收 EPSG:4326）。 */
  readonly srid: number;
  /** GeoJSON 文本。 */
  readonly geojson: string;
}

/** 一次命中的响应形状。 */
export interface ClueGeometryHit {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly partId: string;
  readonly partIndex: number;
  readonly otherPartId: string;
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 重绘响应体。 */
export interface ClueGeometryBody {
  readonly result: 'redrawn';
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly partCount: number;
  readonly dupComputedAt: string;
  readonly hits: readonly ClueGeometryHit[];
}

export type ClueGeometryOutcome =
  | { readonly status: 200; readonly body: ClueGeometryBody }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state'; readonly reason: string } };

@Injectable()
export class ClueGeometryService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
    private readonly verification: ClueVerificationService,
  ) {}

  async redraw(actor: ActorRef, clueId: string, request: ClueGeometryRequest): Promise<ClueGeometryOutcome> {
    const context = await this.clues.readDuplicateContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';

    // 授权第一层：操作码（角色 × 操作码）。拒绝时 authorize 自己写 authz.denied 留痕。
    try {
      await this.access.authorize(actor, GEOMETRY_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（重绘仅限录入人本人）。
    if (context.registeredBy !== actor.personnelId) {
      await this.denyObject(actor, account?.code ?? null, actorOrgId, context);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    // 状态口径：待分派决定／待分派池、未派机构且无活动核查。
    if (context.status !== 'pending_decision' && context.status !== 'in_pool') {
      return this.reject(actor, account?.code ?? null, actorOrgId, clueId, 'invalid-state');
    }
    if (context.assignedOrgUnitIds.length > 0) {
      return this.reject(actor, account?.code ?? null, actorOrgId, clueId, 'invalid-state');
    }
    if (context.verificationStatus === 'running') {
      return this.reject(actor, account?.code ?? null, actorOrgId, clueId, 'invalid-state');
    }

    // 几何解析：法域定形态（土地/矿产＝面，测绘/规划＝点），只收 EPSG:4326。
    const parsed = parseSpatialSource({
      text: request.geojson,
      domain: context.domain as Domain,
      srid: request.srid,
    });
    if (!parsed.ok) {
      return this.rejectGeometry(actor, account?.code ?? null, actorOrgId, clueId, [parsed.rule]);
    }

    const before = context.hits;
    const previousStatus = context.status;
    const parts = parsed.parts.map((part) => ({
      id: newUlid(),
      partIndex: part.partIndex,
      geojson: part.geojson,
      sourceSrid: parsed.sourceSrid,
    }));
    const partCount = parts.length;
    const spatialVersion = spatialVersionOf(parts.map((part) => ({
      partId: part.id,
      partIndex: part.partIndex,
      geojson: part.geojson,
    })));

    // 写事务：换空间版本、整体替换本线索命中集、相关双方完整重算、留痕同成同败。
    let nextStatus = previousStatus;
    let after: readonly ClueHitSummary[] = [];
    const related: {
      readonly otherClueCode: string;
      readonly before: readonly HitSummaryDetail[];
      readonly after: readonly HitSummaryDetail[];
    }[] = [];
    await this.uow.run(async (tx) => {
      // 涉及本线索的命中行先清掉（命中行外键挂旧部件），再换部件。
      await tx.clues.replaceHitSet(clueId, []);
      await tx.clues.replaceSpatialParts(clueId, parts);
      after = await tx.clues.computeHitsForClue(clueId);
      await tx.clues.replaceHitSet(
        clueId,
        after.map((hit) => toHitWrite(hit)),
      );
      nextStatus =
        context.spatialKind === 'face' && after.length > 0 ? 'pending_decision' : 'in_pool';
      if (nextStatus !== previousStatus) {
        await tx.clues.updateClueStatus(clueId, nextStatus);
      }

      // 原命中与新命中涉及的对方线索分别完整重算（related-redraw，不递归）。
      const peerCodes = new Map<string, string>();
      for (const hit of [...before, ...after]) peerCodes.set(hit.otherClueId, hit.otherClueCode);
      for (const [peerId, peerCode] of peerCodes) {
        const peerBefore = await tx.clues.listHitSummaries(peerId);
        const peerAfter = await tx.clues.computeHitsForClue(peerId);
        await tx.clues.replaceHitSet(
          peerId,
          peerAfter.map((hit) => toHitWrite(hit)),
        );
        related.push({
          otherClueCode: peerCode,
          before: toSummaries(peerBefore),
          after: toSummaries(peerAfter),
        });
      }

      await tx.audit.append({
        action: 'clue.geometry-updated',
        ...this.parties(actor, account?.code ?? null, actorOrgId, clueId),
        detail: JSON.stringify({
          code: context.code,
          spatialVersion,
          partCount,
          previousStatus,
          nextStatus,
          trigger: 'redraw',
          before: toSummaries(before),
          after: toSummaries(after),
          relatedRedraw: related,
        }),
      });
    });

    // 土地／矿产重绘后重新内业核查（不可跳过）。投递失败只记日志。
    if (requiresVerification(context.domain)) {
      try {
        await this.verification.scheduleAutomatic(clueId);
      } catch (error) {
        console.error(
          `内业核查自动入队失败（线索 ${clueId}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const reread = await this.clues.readDuplicateContext(clueId);
    return {
      status: 200,
      body: {
        result: 'redrawn',
        id: clueId,
        code: context.code,
        status: nextStatus,
        partCount,
        dupComputedAt: reread?.dupComputedAt?.toISOString() ?? '',
        hits: after.map((hit) => ({
          otherClueId: hit.otherClueId,
          otherClueCode: hit.otherClueCode,
          partId: hit.partId,
          partIndex: hit.partIndex,
          otherPartId: hit.otherPartId,
          otherPartIndex: hit.otherPartIndex,
          selfRatio: hit.selfRatio,
          otherRatio: hit.otherRatio,
          intersectionArea: hit.intersectionArea,
        })),
      },
    };
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async denyObject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    context: ClueDuplicateContext,
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
      opcode: GEOMETRY_OPCODE,
      resourceType: 'clue',
      resourceId: context.clueId,
      previousValue: null,
      targetOrgUnitId: context.enteredOrgId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<ClueGeometryOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 拒绝类留痕：回滚后另起事务写入（#119 口径）。 */
  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    reason: ClueGeometryUpdateFailedReason,
  ): Promise<ClueGeometryOutcome> {
    const outcome: ClueGeometryOutcome = {
      status: 409,
      body: { result: 'invalid-state', reason },
    };
    await this.uow.run(async () =>
      rejected<ClueGeometryOutcome>(outcome, {
        action: 'clue.geometry-updated',
        outcome: 'failed',
        reason,
        ...this.parties(actor, actorCode, orgUnitId, clueId),
      }),
    );
    return outcome;
  }

  /** 几何不合规：400 non-compliant，失败留痕（invalid-geometry）。 */
  private async rejectGeometry(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rules: readonly string[],
  ): Promise<ClueGeometryOutcome> {
    const outcome: ClueGeometryOutcome = { status: 400, body: { result: 'non-compliant', rules } };
    await this.uow.run(async () =>
      rejected<ClueGeometryOutcome>(outcome, {
        action: 'clue.geometry-updated',
        outcome: 'failed',
        reason: 'invalid-geometry',
        ...this.parties(actor, actorCode, orgUnitId, clueId),
      }),
    );
    return outcome;
  }

  /** 留痕的当事人列。反映人明文、精确坐标与要件值不进留痕。 */
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
      opcode: GEOMETRY_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}

/** 命中摘要 → 待写行（正反两行的 id 由调用方生成）。 */
function toHitWrite(hit: ClueHitSummary): ClueHitWrite {
  return {
    id: newUlid(),
    reverseId: newUlid(),
    partId: hit.partId,
    otherClueId: hit.otherClueId,
    otherPartId: hit.otherPartId,
    selfRatio: hit.selfRatio,
    otherRatio: hit.otherRatio,
    intersectionArea: hit.intersectionArea,
  };
}

/** 留痕 detail 里的一条命中摘要（比例保留一位小数，与登记留痕同口径）。 */
interface HitSummaryDetail {
  readonly otherClueCode: string;
  readonly partIndex: number;
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
}

function toSummaries(hits: readonly ClueHitSummary[]): readonly HitSummaryDetail[] {
  return hits.map((hit) => ({
    otherClueCode: hit.otherClueCode,
    partIndex: hit.partIndex,
    otherPartIndex: hit.otherPartIndex,
    selfRatio: Number(hit.selfRatio.toFixed(1)),
    otherRatio: Number(hit.otherRatio.toFixed(1)),
  }));
}
