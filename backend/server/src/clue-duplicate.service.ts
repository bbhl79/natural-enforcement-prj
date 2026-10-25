// 疑似重复比对与实名查阅（#212；规格 B「几何与疑似重复」、规格 G、USER LOCK 七项业务⑦）。
//
// 口径：
// - GET /api/clues/:id/duplicates：疑似重复比对视图。命中面对按对方线索分组，
//   含双方面 ID、双方比例与交集面积（平方米）与 dup_computed_at；点状线索给
//   「不做空间重合判定」说明，不显示比例。
// - 决定步数据契约（默认不派／已知晓／举报必派）在本票落为视图里的 decision 片段；
//   分派决定接口的接线留 #214。
// - 匿名对称保护：本线索或对方线索任一方涉匿名，登记时间只到月、位置只到区
//   （防反向暴露实名举报人）；反映人身份与联系方式默认脱敏，明文只经 reporter-read。
// - POST /api/clues/:id/reporter-read：实名明文唯一出口。显式授权（clue.reference.read）
//   ＋ 查阅留痕（clue.reference-viewed 只记查看事实，不记明文）＋ 响应 no-store。

import { Inject, Injectable } from '@nestjs/common';

import type { AuditParties } from '@natural-enforcement/audit';
import {
  CLUE_STATUS_LABELS,
  CLUE_STORE,
  DISPOSITION_LABELS,
  POINT_NO_OVERLAP_NOTICE,
  doesSpatialOverlapJudgement,
  duplicateDecisionContract,
  formatRegisteredAtDay,
  formatRegisteredAtMonth,
  groupFacesByOtherClue,
  limitedLocation,
  maskReporterContact,
  maskReporterName,
  type ClueStore,
  type FacePair,
} from '@natural-enforcement/case';
import { findSourceGroupCode } from '@natural-enforcement/geo-dict';
import {
  AccessControlService,
  isAccessDenied,
  type ActorRef,
  type DenyReason,
} from '@natural-enforcement/identity';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'clue.read';
const REFERENCE_READ_OPCODE = 'clue.reference.read';

/** 一个命中面对（视图形状）。涉匿名的分组不带几何（防精确坐标外泄）。 */
export interface DuplicateFaceView {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherPartId: string;
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
  /** 本线索该面几何（EPSG:4490 GeoJSON）；涉匿名分组为 null。 */
  readonly selfGeojson: string | null;
  /** 对方该面几何（EPSG:4490 GeoJSON）；涉匿名分组为 null。 */
  readonly otherGeojson: string | null;
}

/** 一个对方线索分组（视图形状）。 */
export interface DuplicateGroupView {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
  readonly otherStatusLabel: string;
  /** 本组任一方涉匿名（对称脱敏已按此生效）。 */
  readonly anonymous: boolean;
  readonly otherRegisteredAt: string;
  readonly otherLocation: string | null;
  readonly otherReporterName: string | null;
  readonly otherReporterContact: string | null;
  readonly faces: readonly DuplicateFaceView[];
}

/** 决定步数据契约（#214 接线用）。 */
export interface DuplicateDecisionView {
  readonly requiresDecision: boolean;
  readonly mustDispatch: boolean;
  readonly allowHold: boolean;
  readonly defaultHold: boolean;
  readonly requireAcknowledge: boolean;
  readonly ruleCodes: readonly string[];
}

/** 历史关联分组（结案线索的空间重合），折叠展示。 */
export interface DuplicateHistoricalGroupView {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
  readonly otherStatusLabel: string;
  readonly anonymous: boolean;
  readonly otherRegisteredAt: string;
  readonly otherLocation: string | null;
  /** 处置类型：no-case | with-old | transfer。 */
  readonly disposition: string | null;
  readonly dispositionLabel: string | null;
  /** 处置时间。 */
  readonly disposedAt: string | null;
  readonly faces: readonly DuplicateFaceView[];
}

/** 疑似重复比对视图。 */
export interface DuplicateView {
  readonly result: 'listed';
  readonly clueId: string;
  readonly code: string;
  /** 几何形态：face | point。 */
  readonly spatialKind: 'face' | 'point';
  /** 点状线索的说明（面状为 null）。 */
  readonly pointNotice: string | null;
  readonly status: string;
  readonly statusLabel: string;
  readonly dupComputedAt: string | null;
  readonly decision: DuplicateDecisionView;
  readonly groups: readonly DuplicateGroupView[];
  /** 历史关联分组（结案线索的空间重合），折叠展示。 */
  readonly historicalGroups: readonly DuplicateHistoricalGroupView[];
}

/** 实名查阅响应体（明文只从这里出）。 */
export interface ReporterReadBody {
  readonly result: 'read';
  readonly clueId: string;
  readonly code: string;
  readonly reporterName: string | null;
  readonly reporterContact: string | null;
}

export type DuplicateOutcome =
  | { readonly status: 200; readonly body: DuplicateView }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

export type ReporterReadOutcome =
  | { readonly status: 200; readonly body: ReporterReadBody }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

@Injectable()
export class ClueDuplicateService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
  ) {}

  /** 疑似重复比对视图：命中按对方线索分组，含决定步契约与对称脱敏。 */
  async read(actor: ActorRef, clueId: string): Promise<DuplicateOutcome> {
    const context = await this.clues.readDuplicateContext(clueId);
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

    const ownValues = await this.clues.readItemValues(clueId);
    const ownAnonymous = isAnonymousText(ownValues['clue.reporter_anonymous']);
    const faces: FacePair[] = context.hits.map((hit) => ({
      partId: hit.partId,
      partIndex: hit.partIndex,
      otherClueId: hit.otherClueId,
      otherClueCode: hit.otherClueCode,
      otherPartId: hit.otherPartId,
      otherPartIndex: hit.otherPartIndex,
      selfRatio: hit.selfRatio,
      otherRatio: hit.otherRatio,
      intersectionArea: hit.intersectionArea,
    }));
    const groups = groupFacesByOtherClue(faces);
    const peers = await this.clues.readDuplicatePeers(groups.map((group) => group.otherClueId));
    const geometryOf = new Map<string, { self: string; other: string }>();
    for (const hit of context.hits) {
      geometryOf.set(`${hit.partId}:${hit.otherPartId}`, { self: hit.selfGeojson, other: hit.otherGeojson });
    }
    const sourceGroupCode = findSourceGroupCode(context.sourceCode);
    const decision = duplicateDecisionContract({
      sourceGroupCode,
      hits: groups.map((group) => ({
        otherClueCode: group.otherClueCode,
        otherStatus: peers.get(group.otherClueId)?.status ?? '',
      })),
    });

    // 历史关联：结案线索（closed, transferred_out）的空间重合（不参与决定步、不写命中表）。
    const historicalRawFaces: FacePair[] = [];
    const histStatusByClue = new Map<string, string>();
    const histDispByClue = new Map<
      string,
      { disposition: string | null; disposedAt: Date | null }
    >();
    if (context.spatialKind === 'face') {
      const historicalHits = await this.clues.listHistoricalHits(clueId);
      for (const hit of historicalHits) {
        historicalRawFaces.push({
          partId: hit.partId,
          partIndex: hit.partIndex,
          otherClueId: hit.otherClueId,
          otherClueCode: hit.otherClueCode,
          otherPartId: hit.otherPartId,
          otherPartIndex: hit.otherPartIndex,
          selfRatio: hit.selfRatio,
          otherRatio: hit.otherRatio,
          intersectionArea: hit.intersectionArea,
        });
        histStatusByClue.set(hit.otherClueId, hit.otherStatus);
        histDispByClue.set(hit.otherClueId, {
          disposition: hit.otherDisposition,
          disposedAt: hit.otherDisposedAt,
        });
        geometryOf.set(`${hit.partId}:${hit.otherPartId}`, {
          self: hit.selfGeojson,
          other: hit.otherGeojson,
        });
      }
    }
    const historicalGroups = groupFacesByOtherClue(historicalRawFaces);
    const histPeerIds = historicalGroups.map((g) => g.otherClueId);
    const histPeers =
      histPeerIds.length > 0 ? await this.clues.readDuplicatePeers(histPeerIds) : new Map();

    return {
      status: 200,
      body: {
        result: 'listed',
        clueId: context.clueId,
        code: context.code,
        spatialKind: context.spatialKind,
        pointNotice: doesSpatialOverlapJudgement(context.spatialKind as 'face' | 'point')
          ? null
          : POINT_NO_OVERLAP_NOTICE,
        status: context.status,
        statusLabel: CLUE_STATUS_LABELS[context.status] ?? context.status,
        dupComputedAt: context.dupComputedAt?.toISOString() ?? null,
        decision: {
          requiresDecision: decision.requiresDecision,
          mustDispatch: decision.mustDispatch,
          allowHold: decision.allowHold,
          defaultHold: decision.defaultHold,
          requireAcknowledge: decision.requireAcknowledge,
          ruleCodes: decision.ruleCodes,
        },
        groups: groups.map((group) => {
          const peer = peers.get(group.otherClueId);
          // 匿名对称保护：任一方涉匿名，双方展示都收紧。
          const anonymous = ownAnonymous || (peer?.reporterAnonymous ?? false);
          return {
            otherClueId: group.otherClueId,
            otherClueCode: group.otherClueCode,
            otherStatus: peer?.status ?? '',
            otherStatusLabel: CLUE_STATUS_LABELS[peer?.status ?? ''] ?? (peer?.status ?? ''),
            anonymous,
            otherRegisteredAt:
              peer === undefined
                ? ''
                : anonymous
                  ? formatRegisteredAtMonth(peer.registeredAt)
                  : formatRegisteredAtDay(peer.registeredAt),
            otherLocation: anonymous ? limitedLocation(peer?.location ?? null) : (peer?.location ?? null),
            // 实名默认脱敏显示；明文只经 reporter-read 取（对称脱敏仍适用）。
            otherReporterName: maskReporterName(peer?.reporterName ?? null),
            otherReporterContact: maskReporterContact(peer?.reporterContact ?? null),
            faces: group.faces.map((face) => {
              const geometry = geometryOf.get(`${face.partId}:${face.otherPartId}`);
              return {
                partId: face.partId,
                partIndex: face.partIndex,
                otherPartId: face.otherPartId,
                otherPartIndex: face.otherPartIndex,
                selfRatio: face.selfRatio,
                otherRatio: face.otherRatio,
                intersectionArea: face.intersectionArea,
                // 涉匿名分组不带几何：精确坐标不外泄。
                selfGeojson: anonymous ? null : (geometry?.self ?? null),
                otherGeojson: anonymous ? null : (geometry?.other ?? null),
              };
            }),
          };
        }),
        historicalGroups: historicalGroups.map((group) => {
          const peer = histPeers.get(group.otherClueId);
          const anonymous = ownAnonymous || (peer?.reporterAnonymous ?? false);
          const disp = histDispByClue.get(group.otherClueId);
          const status = peer?.status ?? histStatusByClue.get(group.otherClueId) ?? '';
          return {
            otherClueId: group.otherClueId,
            otherClueCode: group.otherClueCode,
            otherStatus: status,
            otherStatusLabel: CLUE_STATUS_LABELS[status] ?? status,
            anonymous,
            otherRegisteredAt:
              peer === undefined
                ? ''
                : anonymous
                  ? formatRegisteredAtMonth(peer.registeredAt)
                  : formatRegisteredAtDay(peer.registeredAt),
            otherLocation: anonymous
              ? limitedLocation(peer?.location ?? null)
              : (peer?.location ?? null),
            disposition: disp?.disposition ?? null,
            dispositionLabel:
              disp?.disposition !== null && disp?.disposition !== undefined
                ? (DISPOSITION_LABELS[disp.disposition] ?? disp.disposition)
                : null,
            disposedAt: disp?.disposedAt?.toISOString() ?? null,
            faces: group.faces.map((face) => {
              const geometry = geometryOf.get(`${face.partId}:${face.otherPartId}`);
              return {
                partId: face.partId,
                partIndex: face.partIndex,
                otherPartId: face.otherPartId,
                otherPartIndex: face.otherPartIndex,
                selfRatio: face.selfRatio,
                otherRatio: face.otherRatio,
                intersectionArea: face.intersectionArea,
                selfGeojson: anonymous ? null : (geometry?.self ?? null),
                otherGeojson: anonymous ? null : (geometry?.other ?? null),
              };
            }),
          };
        }),
      },
    };
  }

  /**
   * 实名查阅：明文唯一出口。显式授权＋查阅留痕（只记查看事实）＋响应头 no-store。
   * 线索没有反映人信息（非举报类来源）即 404。
   */
  async readReporter(actor: ActorRef, clueId: string): Promise<ReporterReadOutcome> {
    const context = await this.clues.readDuplicateContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    try {
      await this.access.authorize(actor, REFERENCE_READ_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const values = await this.clues.readItemValues(clueId);
    const reporterName = values['clue.reporter_name'] ?? null;
    const reporterContact = values['clue.reporter_contact'] ?? null;
    if (reporterName === null && reporterContact === null) {
      return { status: 404, body: { result: 'not-found' } };
    }

    const account = await this.directory.findById(actor.personnelId);
    await this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'clue.reference-viewed',
        ...this.parties(actor, account?.code ?? null, account?.orgUnitId ?? null, clueId),
        detail: JSON.stringify({ code: context.code }),
      });
    });
    return {
      status: 200,
      body: {
        result: 'read',
        clueId: context.clueId,
        code: context.code,
        reporterName,
        reporterContact,
      },
    };
  }

  /** 留痕的当事人列。反映人明文不进留痕：本动作只记查看事实。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string | null,
    clueId: string,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: REFERENCE_READ_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}

/** 匿名取值文本是否为「是」；空值即否。 */
function isAnonymousText(value: string | null | undefined): boolean {
  return value === 'true' || value === 'yes' || value === '1' || value === '是';
}
