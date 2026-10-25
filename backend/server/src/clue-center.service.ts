// 线索中心（#207）。
//
// 列表：GET /api/clues?view=all&page=1&size=20&q=&domain=&source=&org=&status=&check=&gap=&from=&to=
// 详情：GET /api/clues/:id/detail   线索基本信息与要件
// 补齐：POST /api/clues/:id/gap-fill 补齐缺件（单件或多项）
// 留痕：GET /api/clues/:id/trail    流转与留痕
//
// 列表行不含反映人字段。数据范围：entered_org_id 或当前承办机构在操作者机构子树内。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditParties,
  type ClueItemsSupplementFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  CLUE_STATUS_LABELS,
  maskReporterContact,
  maskReporterName,
  type ClueDetailRow,
  type ClueItemGapRow,
  type ClueListPage,
  type ClueStore,
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

const READ_OPCODE = 'clue.read';
const SUPPLEMENT_OPCODE = 'clue.item.supplement';

// ---- 列表 ----

/** 线索中心列表成功响应体。 */
export interface ClueCenterListBody {
  readonly result: 'listed';
  readonly rows: ClueListPage['rows'];
  readonly total: number;
  readonly page: number;
  readonly size: number;
}

export type ClueCenterListOutcome =
  | { readonly status: 200; readonly body: ClueCenterListBody }
  | { readonly status: 403; readonly body: { readonly reason: string } };

/** 线索中心列表查询参数（HTTP 查询串映射）。 */
export interface ClueCenterListQuery {
  view?: string;
  page?: string;
  size?: string;
  q?: string;
  domain?: string;
  source?: string;
  org?: string;
  status?: string;
  check?: string;
  gap?: string;
  from?: string;
  to?: string;
}

// ---- 详情 ----

/** 详情视图：基本信息、要件、缺件、取值、标签、违法类型与反映人脱敏信息。 */
export interface ClueDetailView {
  readonly code: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly verificationStatus: string;
  readonly receivedAt: string;
  readonly registeredAt: string;
  readonly narrative: string;
  readonly subjectUnknown: boolean;
  readonly anonymityConfirmed: boolean;
  readonly requirements: ClueDetailRow['requirements'];
  readonly gaps: readonly ClueItemGapRow[];
  readonly values: ClueDetailRow['values'];
  readonly reporterName: string | null;
  readonly reporterContact: string | null;
  readonly tags: readonly string[];
  readonly initialTypes: readonly string[];
}

// ---- 补齐 ----

/** 补齐请求体（单件）。 */
export interface GapFillOneBody {
  readonly key?: unknown;
  readonly value?: unknown;
}

/** 补齐请求体（多项）。 */
export interface GapFillManyBody {
  readonly keys?: unknown;
  readonly values?: unknown;
}

export type GapFillBody = GapFillOneBody | GapFillManyBody;

/** 补齐结果。 */
export interface ClueGapFillView {
  readonly result: 'supplemented';
  readonly clueId: string;
  readonly code: string;
  readonly filled: readonly { readonly key: string; readonly label: string }[];
  readonly gaps: readonly { readonly key: string; readonly label: string }[];
}

// ---- 留痕 ----

/** 留痕行视图（不含 detail 字段）。 */
export interface ClueTrailView {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly outcome: string;
  readonly actorCode: string | null;
  readonly subjectCode: string | null;
  readonly orgUnitId: string | null;
  readonly opcode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly reason: string | null;
}

// ---- 产出 ----

export type DetailOutcome =
  | { readonly status: 200; readonly body: ClueDetailView }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

export type GapFillOutcome =
  | { readonly status: 200; readonly body: ClueGapFillView }
  | {
      readonly status: 400;
      readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] };
    }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

export type TrailOutcome =
  | {
      readonly status: 200;
      readonly body: { readonly result: 'listed'; readonly rows: readonly ClueTrailView[] };
    }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

/** 校验不通过。 */
interface Rejection {
  readonly rules: readonly string[];
  readonly reason: ClueItemsSupplementFailedReason;
}

// ---- 服务 ----

@Injectable()
export class ClueCenterService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
  ) {}

  // ---- 列表 ----

  /** 线索中心列表：按视图、关键词与多维筛选分页列出操作者可见的线索。 */
  async list(actor: ActorRef, query: ClueCenterListQuery): Promise<ClueCenterListOutcome> {
    const orgUnitIds = await this.access.listDataScopeOrgUnitIds(actor.personnelId);
    if (orgUnitIds.length === 0) {
      return { status: 403, body: { reason: 'scope-denied' } };
    }

    const page = this.normalizePage(query.page);
    const size = this.normalizeSize(query.size);

    const result = await this.clues.listClues({
      view: this.normalizeView(query.view),
      page,
      size,
      keyword: (query.q ?? '').trim(),
      domain: (query.domain ?? '').trim(),
      source: (query.source ?? '').trim(),
      org: (query.org ?? '').trim(),
      status: (query.status ?? '').trim(),
      check: (query.check ?? '').trim(),
      gap: (query.gap ?? '').trim(),
      from: (query.from ?? '').trim(),
      to: (query.to ?? '').trim(),
      orgUnitIds,
    });

    return {
      status: 200,
      body: {
        result: 'listed',
        rows: result.rows,
        total: result.total,
        page: result.page,
        size: result.size,
      },
    };
  }

  // ---- 详情 ----

  /** 线索详情：基本信息、要件快照、缺件、取值、标签、违法类型与反映人脱敏信息。 */
  async readDetail(actor: ActorRef, clueId: string): Promise<DetailOutcome> {
    const detail = await this.clues.readDetail(clueId);
    if (!detail) return { status: 404, body: { result: 'not-found' } };

    try {
      await this.access.authorize(actor, READ_OPCODE, detail.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    const valueMap = new Map(detail.values.map((v) => [v.key, v.value]));

    return {
      status: 200,
      body: {
        code: detail.code,
        domain: detail.domain,
        sourceCode: detail.sourceCode,
        status: detail.status,
        statusLabel: CLUE_STATUS_LABELS[detail.status] ?? detail.status,
        verificationStatus: detail.verificationStatus,
        receivedAt: detail.receivedAt.toISOString(),
        registeredAt: detail.registeredAt.toISOString(),
        narrative: detail.narrative,
        subjectUnknown: detail.subjectUnknown,
        anonymityConfirmed: detail.anonymityConfirmed,
        requirements: detail.requirements,
        gaps: detail.gaps,
        values: detail.values,
        reporterName:
          detail.anonymityConfirmed
            ? null
            : maskReporterName(valueMap.get('clue.reporter_name') ?? null),
        reporterContact:
          detail.anonymityConfirmed
            ? null
            : maskReporterContact(valueMap.get('clue.reporter_contact') ?? null),
        tags: detail.tags.map((tag) => tag.name),
        initialTypes: detail.initialTypes,
      },
    };
  }

  // ---- 补齐 ----

  /** 补齐缺件：单件 {key, value} 或多项 {keys, values}。 */
  async fillGap(actor: ActorRef, clueId: string, body: GapFillBody): Promise<GapFillOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';

    const clue = await this.clues.readRegistrationResult(clueId);
    if (!clue) return { status: 404, body: { result: 'not-found' } };

    const target = await this.clues.readClueOrgUnitId(clueId);
    try {
      await this.access.authorize(actor, SUPPLEMENT_OPCODE, target ?? actorOrgId);
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    const submitted = readGapFillValues(body);
    if (submitted === null) {
      return this.reject(actor, account?.code ?? null, actorOrgId, {
        rules: ['missing-required-items'],
        reason: 'missing-required-items',
      });
    }

    if (submitted.length === 0) {
      return this.reject(actor, account?.code ?? null, actorOrgId, {
        rules: ['missing-required-items'],
        reason: 'missing-required-items',
      });
    }

    const openGaps = await this.clues.listOpenGaps(clueId);
    const openKeys = new Set(openGaps.map((gap) => gap.key));
    const unknown = submitted.filter(([key]) => !openKeys.has(key));
    if (unknown.length > 0) {
      return this.reject(actor, account?.code ?? null, actorOrgId, {
        rules: ['value-invalid'],
        reason: 'invalid-form',
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

  // ---- 留痕 ----

  /** 流转留痕：该线索的全部审计记录，不含 detail 字段。 */
  async listTrail(actor: ActorRef, clueId: string): Promise<TrailOutcome> {
    const clue = await this.clues.readRegistrationResult(clueId);
    if (!clue) return { status: 404, body: { result: 'not-found' } };

    const target = await this.clues.readClueOrgUnitId(clueId);
    try {
      await this.access.authorize(actor, READ_OPCODE, target ?? '', {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }

    const records = await this.clues.listTrail(clueId);
    return {
      status: 200,
      body: {
        result: 'listed',
        rows: records.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          action: row.action,
          outcome: row.outcome,
          actorCode: row.actorCode,
          subjectCode: row.subjectCode,
          orgUnitId: row.orgUnitId,
          opcode: row.opcode,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          reason: row.reason,
        })),
      },
    };
  }

  // ---- 内部 ----

  /** 失败留痕：拒绝类留痕在回滚后另起事务写入（#119 口径）。 */
  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    rejection: Rejection,
  ): Promise<GapFillOutcome> {
    const outcome: GapFillOutcome = {
      status: 400,
      body: { result: 'non-compliant', rules: rejection.rules },
    };
    await this.uow.run(async () =>
      rejected<GapFillOutcome>(outcome, {
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
      opcode: clueId ? SUPPLEMENT_OPCODE : null,
      resourceType: clueId === null ? null : 'clue',
      resourceId: clueId,
    };
  }

  private normalizeView(raw: string | undefined): 'all' | 'assign' | 'held' | 'remind' {
    if (raw === 'assign' || raw === 'held' || raw === 'remind') return raw;
    return 'all';
  }

  private normalizePage(raw: string | undefined): number {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }

  private normalizeSize(raw: string | undefined): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 20;
    return Math.min(Math.floor(n), 100);
  }
}

// ---- 工具函数 ----

/** 从请求体读出待补齐的键值对。单件 {key, value} 或多项 {keys, values}。解析失败返回 null。 */
function readGapFillValues(
  body: GapFillBody | undefined,
): readonly (readonly [string, string])[] | null {
  if (!body || typeof body !== 'object') return null;

  const asRecord = body as Record<string, unknown>;

  // 单件：{ key: string, value: string }
  if (typeof asRecord.key === 'string' && typeof asRecord.value === 'string') {
    if (asRecord.key.trim() === '' || asRecord.value.trim() === '') return [];
    return [[asRecord.key, asRecord.value]];
  }

  // 多项：{ keys: string[], values: Record<string, string> }
  if (
    Array.isArray(asRecord.keys) &&
    typeof asRecord.values === 'object' &&
    asRecord.values !== null
  ) {
    const keys = asRecord.keys as unknown[];
    const values = asRecord.values as Record<string, unknown>;
    const result: (readonly [string, string])[] = [];
    for (const key of keys) {
      if (typeof key !== 'string' || key.trim() === '') continue;
      const value = values[key];
      if (typeof value !== 'string' || value.trim() === '') continue;
      result.push([key, value]);
    }
    return result;
  }

  return null;
}