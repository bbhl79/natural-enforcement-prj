// 线索持久化的 Prisma 适配（#211）。
// 本文件是模块内唯一 import 生成客户端的文件（同身份组织模块的 PrismaIdentityStore）。
// 仓库内不生成 Prisma Client（产物只存在于容器可写层），故本文件被根 tsconfig 排除在
// unit 层类型检查之外，由 integration 层（dev test integration：先 prisma generate 再
// tsc -p integration）承载其编译。
//
// 空间纪律（执行纪律 2）：空间对象、空间部件与命中集三表走 $queryRaw + ST_ 函数，
// 禁 ORM create/update。命中集的比对按逐面进行：双方各自以单面 geography 面积作分母，
// 任一方达到阈值即该面对命中（规格 B）。
//
// 事务纪律：调用方在交互式事务里调本适配器，业务行与留痕同成同败（#119）。

import { Prisma, type PrismaClient } from '../../../prisma/generated/prisma/client.ts';

import type { VerificationLayerResult } from '../clue/verification/port.ts';
import { ClueIdempotencyConflictError, ClueVerificationRunningError } from './clue-store.ts';
import type {
  ClueClosureReminderRow,
  ClueClosureReminderRowToWrite,
  ClueClosureReminderTarget,
  ClueDecisionWrite,
  ClueDispositionWrite,
  ClueDispatchContext,
  ClueGapFillOutcome,
  ClueGapFillWrite,
  ClueHeldRow,
  ClueItemGapRow,
  ClueHitSummary,
  ClueHitWrite,
  ClueIdempotencyRow,
  ClueOrgAssignWrite,
  CluePeopleAssignWrite,
  ClueRegistrationOutcome,
  ClueRegistrationResult,
  ClueRegistrationWrite,
  ClueReminderResolveWrite,
  ClueSpatialPartRow,
  ClueStore,
  ClueVerificationArtifacts,
  ClueVerificationContext,
  ClueVerificationFinishWrite,
  ClueVerificationRunRow,
  ClueVerificationRunWrite,
  ClueWithdrawContext,
  ClueWithdrawWrite,
} from './clue-store.ts';

/** Prisma 根客户端，或一个交互式事务客户端。 */
type Db = PrismaClient | Prisma.TransactionClient;

/** 入库统一坐标口径：EPSG:4490（CGCS2000 地理坐标系）。 */
const TARGET_SRID = 4490;

/**
 * 疑似重复的重合阈值（规格 B、USER LOCK 七项业务①）。
 * 逐面判定：交集占任一方的单面面积达到该值即命中；整体合并不算。
 */
export const DUPLICATE_OVERLAP_THRESHOLD = 0.6;

/**
 * 退出比对的线索状态：结案与已移送的退出比对；已立案（filed）仍算未结案，继续参与比对。
 * 其余状态（待分派决定、待分派池、已派机构、已派承办人、暂缓）都参与比对。
 */
const NOT_COMPARABLE_STATUSES = ['closed', 'transferred_out'];

/** 线索编号格式：CL + 10 位补零（业务编号与主键分离，永不当引用键）。 */
export function formatClueCode(sequence: bigint | number): string {
  return `CL${String(sequence).padStart(10, '0')}`;
}

/** Prisma 唯一约束冲突。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

interface OverlapRow {
  part_index: number;
  part_id: string;
  clue_id: string;
  clue_code: string;
  other_part_id: string;
  inter_area: number;
  self_area: number;
  other_area: number;
}

export class PrismaClueStore implements ClueStore {
  constructor(private readonly prisma: Db) {}

  async findByIdempotencyKey(key: string): Promise<ClueIdempotencyRow | null> {
    const row = await this.prisma.clue.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    return { id: row.id, code: row.code, requestDigest: row.requestDigest, status: row.status };
  }

  async readRegistrationResult(clueId: string): Promise<ClueRegistrationResult | null> {
    const clue = await this.prisma.clue.findUnique({ where: { id: clueId } });
    if (!clue) return null;
    const gaps = await this.prisma.clueItemGap.findMany({
      where: { clueId, filledAt: null },
      orderBy: { key: 'asc' },
    });
    const hits = await this.prisma.$queryRaw<
      Array<{
        part_id: string;
        part_index: number;
        other_clue_id: string;
        other_clue_code: string;
        other_part_id: string;
        self_ratio: number;
        other_ratio: number;
        intersection_area: number;
      }>
    >`
      SELECT h.spatial_part_id AS part_id,
             p.part_index,
             h.other_clue_id,
             c.code AS other_clue_code,
             h.other_part_id,
             h.self_ratio,
             h.other_ratio,
             h.intersection_area
      FROM clue_spatial_hit h
      JOIN clue c ON c.id = h.other_clue_id
      JOIN clue_spatial_part p ON p.id = h.spatial_part_id
      WHERE h.clue_id = ${clueId}
      ORDER BY h.other_clue_id, h.spatial_part_id
    `;
    return {
      id: clue.id,
      code: clue.code,
      status: clue.status,
      gaps: gaps.map((gap) => ({ key: gap.key, label: gap.label })),
      hits: hits.map((hit) => ({
        partId: hit.part_id,
        partIndex: hit.part_index,
        otherClueId: hit.other_clue_id,
        otherClueCode: hit.other_clue_code,
        otherPartId: hit.other_part_id,
        selfRatio: hit.self_ratio,
        otherRatio: hit.other_ratio,
        intersectionArea: hit.intersection_area,
      })),
    };
  }

  async insertRegistration(write: ClueRegistrationWrite): Promise<ClueRegistrationOutcome> {
    const code = await this.nextCode();
    const hits = write.spatial.kind === 'face' ? await this.computeHits(write.spatial.parts) : [];
    // 面状有正式命中进待分派决定，无命中与点状进待分派池（规格 A）。
    const status = hits.length > 0 ? 'pending_decision' : 'in_pool';

    try {
      await this.prisma.clue.create({
        data: {
          id: write.clue.id,
          code,
          sourceCode: write.clue.sourceCode,
          domain: write.clue.domain,
          receivedAt: write.clue.receivedAt,
          narrative: write.clue.narrative,
          subjectUnknown: write.clue.subjectUnknown,
          anonymityConfirmed: write.clue.anonymityConfirmed,
          status,
          registeredBy: write.clue.registeredBy,
          enteredOrgId: write.clue.enteredOrgId,
          idempotencyKey: write.clue.idempotencyKey,
          requestDigest: write.clue.requestDigest,
          sessionId: write.clue.sessionId,
        },
      });
    } catch (error) {
      // 幂等键唯一约束：并发同键登记撞车，交给调用方回首次结果或 409。
      if (isUniqueViolation(error)) throw new ClueIdempotencyConflictError();
      throw error;
    }

    if (write.requirements.length > 0) {
      await this.prisma.clueRequirementSnapshot.createMany({
        data: write.requirements.map((row) => ({
          id: row.id,
          clueId: write.clue.id,
          key: row.key,
          layer: row.layer,
          group: row.group,
          label: row.label,
          required: row.required,
          consequence: row.consequence,
          timing: row.timing,
          declarationVersion: row.declarationVersion,
        })),
      });
    }
    if (write.values.length > 0) {
      await this.prisma.clueItemValue.createMany({
        data: write.values.map((row) => ({
          id: row.id,
          clueId: write.clue.id,
          key: row.key,
          value: row.value,
        })),
      });
    }
    if (write.gaps.length > 0) {
      await this.prisma.clueItemGap.createMany({
        data: write.gaps.map((row) => ({
          id: row.id,
          clueId: write.clue.id,
          key: row.key,
          layer: row.layer,
          label: row.label,
          required: row.required,
          timing: row.timing,
          consequence: row.consequence,
        })),
      });
    }
    if (write.initialTypes.length > 0) {
      await this.prisma.clueInitialType.createMany({
        data: write.initialTypes.map((row) => ({
          id: row.id,
          clueId: write.clue.id,
          typeCode: row.typeCode,
        })),
      });
    }
    await this.insertTags(write.clue.id, write.tags);
    if (write.materials.length > 0) {
      await this.prisma.clueMaterial.createMany({
        data: write.materials.map((row) => ({
          id: row.id,
          clueId: write.clue.id,
          kind: row.kind,
          fileKey: row.fileKey,
          versionId: row.versionId,
          fileName: row.fileName,
          contentType: row.contentType,
          byteSize: row.byteSize,
          digest: row.digest,
        })),
      });
    }
    await this.insertSpatial(write.clue.id, write.clue.domain, write.spatial);

    return { code, status, hits };
  }

  async insertHits(clueId: string, hits: readonly ClueHitWrite[]): Promise<void> {
    for (const hit of hits) {
      await this.prisma.$queryRaw`
        INSERT INTO clue_spatial_hit
          (id, clue_id, spatial_part_id, other_clue_id, other_part_id, self_ratio, other_ratio, intersection_area, computed_at)
        VALUES
          (${hit.id}, ${clueId}, ${hit.partId}, ${hit.otherClueId}, ${hit.otherPartId},
           ${hit.selfRatio}, ${hit.otherRatio}, ${hit.intersectionArea}, now())
        ON CONFLICT (clue_id, spatial_part_id, other_clue_id, other_part_id) DO NOTHING
      `;
      // 反向行：对方线索也打上疑似重复标记（规格 B：不改对方状态）。
      await this.prisma.$queryRaw`
        INSERT INTO clue_spatial_hit
          (id, clue_id, spatial_part_id, other_clue_id, other_part_id, self_ratio, other_ratio, intersection_area, computed_at)
        VALUES
          (${hit.reverseId}, ${hit.otherClueId}, ${hit.otherPartId}, ${clueId}, ${hit.partId},
           ${hit.otherRatio}, ${hit.selfRatio}, ${hit.intersectionArea}, now())
        ON CONFLICT (clue_id, spatial_part_id, other_clue_id, other_part_id) DO NOTHING
      `;
    }
  }

  async readClueOrgUnitId(clueId: string): Promise<string | null> {
    const row = await this.prisma.clue.findUnique({
      where: { id: clueId },
      select: { enteredOrgId: true },
    });
    return row?.enteredOrgId ?? null;
  }

  async listOpenGaps(clueId: string): Promise<ClueItemGapRow[]> {
    const rows = await this.prisma.clueItemGap.findMany({
      where: { clueId, filledAt: null },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      layer: row.layer,
      label: row.label,
      required: row.required,
      timing: row.timing,
      consequence: row.consequence,
    }));
  }

  /**
   * 补齐缺件：写要件取值并把对应缺件标为已补齐。
   * 缺件行保留为事实（补齐时间写在行上），未补齐的清单随之外。
   */
  async fillGaps(write: ClueGapFillWrite): Promise<ClueGapFillOutcome> {
    for (const value of write.values) {
      await this.prisma.clueItemValue.upsert({
        where: { clueId_key: { clueId: write.clueId, key: value.key } },
        create: { id: value.id, clueId: write.clueId, key: value.key, value: value.value },
        update: { value: value.value },
      });
    }
    if (write.gapIds.length > 0) {
      await this.prisma.clueItemGap.updateMany({
        where: { id: { in: [...write.gapIds] }, clueId: write.clueId, filledAt: null },
        data: { filledAt: write.filledAt },
      });
    }
    const remaining = await this.prisma.clueItemGap.findMany({
      where: { clueId: write.clueId, filledAt: null },
      orderBy: { key: 'asc' },
    });
    const filled = await this.prisma.clueItemGap.findMany({
      where: { id: { in: [...write.gapIds] }, clueId: write.clueId },
      orderBy: { key: 'asc' },
    });
    return {
      filledKeys: filled.map((row) => row.key),
      remaining: remaining.map((row) => ({ key: row.key, label: row.label })),
    };
  }

  async readVerificationContext(clueId: string): Promise<ClueVerificationContext | null> {
    const clue = await this.prisma.clue.findUnique({
      where: { id: clueId },
      select: {
        id: true,
        code: true,
        domain: true,
        status: true,
        registeredBy: true,
        enteredOrgId: true,
      },
    });
    if (!clue) return null;
    // 几何走 $queryRaw：几何列是 Unsupported 类型，ORM 取不出；面积按地理面积算（平方米）。
    const parts = await this.prisma.$queryRaw<
      Array<{ part_id: string; part_index: number; geojson: string }>
    >`
      SELECT p.id AS part_id, p.part_index, ST_AsGeoJSON(p.geom) AS geojson
      FROM clue_spatial_part p
      JOIN clue_spatial_object o ON o.id = p.spatial_object_id
      WHERE o.clue_id = ${clueId}
      ORDER BY p.part_index
    `;
    const areas = await this.prisma.$queryRaw<Array<{ total_area: number | null }>>`
      SELECT SUM(ST_Area(p.geom::geography)) AS total_area
      FROM clue_spatial_part p
      JOIN clue_spatial_object o ON o.id = p.spatial_object_id
      WHERE o.clue_id = ${clueId}
    `;
    return {
      clueId: clue.id,
      code: clue.code,
      domain: clue.domain,
      status: clue.status,
      registeredBy: clue.registeredBy,
      enteredOrgId: clue.enteredOrgId,
      orgUnitIds: await this.readOwningOrgUnitIds(clue.id, clue.enteredOrgId),
      totalArea: Number(areas[0]?.total_area ?? 0),
      parts: parts.map((part) => ({
        partId: part.part_id,
        partIndex: part.part_index,
        geojson: part.geojson,
      })),
    };
  }

  /** 线索归属的机构：登记机构与当前有效的接收机构。 */
  private async readOwningOrgUnitIds(clueId: string, enteredOrgId: string): Promise<string[]> {
    const rows = await this.prisma.clueAssignment.findMany({
      where: { clueId, endedAt: null },
      select: { orgUnitId: true },
    });
    return [...new Set([enteredOrgId, ...rows.map((row) => row.orgUnitId)])];
  }

  async nextVerificationRunNo(clueId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ next_no: number | bigint }>>`
      SELECT COALESCE(MAX(run_no), 0) + 1 AS next_no
      FROM clue_verification_run
      WHERE clue_id = ${clueId}
    `;
    return Number(rows[0]?.next_no ?? 1);
  }

  async insertVerificationRun(write: ClueVerificationRunWrite): Promise<void> {
    try {
      await this.prisma.clueVerificationRun.create({
        data: {
          id: write.id,
          clueId: write.clueId,
          runNo: write.runNo,
          status: 'running',
          attemptsUsed: 0,
          trigger: write.trigger,
          startedAt: write.startedAt,
        },
      });
    } catch (error) {
      // 活动核查的部分唯一索引与运行序号的唯一约束都挡并发：调用方据此回 409。
      if (isUniqueViolation(error)) throw new ClueVerificationRunningError();
      throw error;
    }
    await this.prisma.clue.update({
      where: { id: write.clueId },
      data: { verificationStatus: 'running' },
    });
  }

  async readVerificationRun(runId: string): Promise<ClueVerificationRunRow | null> {
    const row = await this.prisma.clueVerificationRun.findUnique({ where: { id: runId } });
    return row === null ? null : toRunRow(row);
  }

  async listVerificationRuns(clueId: string): Promise<ClueVerificationRunRow[]> {
    const rows = await this.prisma.clueVerificationRun.findMany({
      where: { clueId },
      orderBy: { runNo: 'desc' },
    });
    return rows.map(toRunRow);
  }

  async finishVerificationRun(write: ClueVerificationFinishWrite): Promise<void> {
    const updated = await this.prisma.clueVerificationRun.update({
      where: { id: write.runId },
      data: {
        status: write.status,
        attemptsUsed: write.attemptsUsed,
        failureCategory: write.failureCategory,
        missingLayers: write.missingLayers.length > 0 ? JSON.stringify(write.missingLayers) : null,
        layersJson: write.layers.length > 0 ? JSON.stringify(write.layers) : null,
        artifactsJson: write.artifacts === null ? null : JSON.stringify(write.artifacts),
        endedAt: write.endedAt,
      },
      select: { clueId: true },
    });
    // 核查状态是正交属性：只改核查状态，不动线索主状态。
    await this.prisma.clue.update({
      where: { id: updated.clueId },
      data: { verificationStatus: write.status === 'done' ? 'done' : 'failed' },
    });
  }

  async recordVerificationAttempt(runId: string, attemptsUsed: number): Promise<void> {
    await this.prisma.clueVerificationRun.update({
      where: { id: runId },
      data: { attemptsUsed },
    });
  }

  async listActiveHandlers(
    clueId: string,
  ): Promise<readonly { personnelId: string; role: string }[]> {
    const rows = await this.prisma.clueHandler.findMany({
      where: { clueId, endedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    return rows.map((row) => ({ personnelId: row.personnelId, role: row.role }));
  }

  async readDispatchContext(clueId: string): Promise<ClueDispatchContext | null> {
    const clue = await this.prisma.clue.findUnique({ where: { id: clueId } });
    if (!clue) return null;
    const object = await this.prisma.clueSpatialObject.findUnique({
      where: { clueId },
    });
    const parts = await this.prisma.$queryRaw<
      Array<{ part_id: string; part_index: number; geojson: string }>
    >`
      SELECT p.id AS part_id, p.part_index, ST_AsGeoJSON(p.geom) AS geojson
      FROM clue_spatial_part p
      JOIN clue_spatial_object o ON o.id = p.spatial_object_id
      WHERE o.clue_id = ${clueId}
      ORDER BY p.part_index
    `;
    const areas = await this.prisma.$queryRaw<Array<{ total_area: number | null }>>`
      SELECT SUM(ST_Area(p.geom::geography)) AS total_area
      FROM clue_spatial_part p
      JOIN clue_spatial_object o ON o.id = p.spatial_object_id
      WHERE o.clue_id = ${clueId}
    `;
    const assignmentRow = await this.prisma.clueAssignment.findFirst({
      where: { clueId, endedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    const handlerRows = await this.prisma.clueHandler.findMany({
      where: { clueId, endedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    const hits = await this.prisma.$queryRaw<
      Array<{
        part_id: string;
        part_index: number;
        other_clue_id: string;
        other_clue_code: string;
        other_part_id: string;
        other_status: string;
        self_ratio: number;
        other_ratio: number;
        intersection_area: number;
      }>
    >`
      SELECT h.spatial_part_id AS part_id,
             p.part_index,
             h.other_clue_id,
             c.code AS other_clue_code,
             h.other_part_id,
             c.status AS other_status,
             h.self_ratio,
             h.other_ratio,
             h.intersection_area
      FROM clue_spatial_hit h
      JOIN clue c ON c.id = h.other_clue_id
      JOIN clue_spatial_part p ON p.id = h.spatial_part_id
      WHERE h.clue_id = ${clueId}
      ORDER BY h.other_clue_id, h.spatial_part_id
    `;
    return {
      clueId: clue.id,
      code: clue.code,
      status: clue.status,
      sourceCode: clue.sourceCode,
      domain: clue.domain,
      registeredBy: clue.registeredBy,
      enteredOrgId: clue.enteredOrgId,
      kind: object?.kind === 'point' ? 'point' : 'face',
      totalArea: Number(areas[0]?.total_area ?? 0),
      dupComputedAt: object?.dupComputedAt ?? null,
      parts: parts.map((part) => ({
        partId: part.part_id,
        partIndex: part.part_index,
        geojson: part.geojson,
      })),
      assignment:
        assignmentRow === null
          ? null
          : {
              orgUnitId: assignmentRow.orgUnitId,
              kind: assignmentRow.kind,
              designate: assignmentRow.designate,
              assignedBy: assignmentRow.assignedBy,
              assignedByOrgId: assignmentRow.assignedByOrgId,
            },
      handlers: handlerRows.map((row) => ({ personnelId: row.personnelId, role: row.role })),
      hits: hits.map((hit) => ({
        partId: hit.part_id,
        partIndex: hit.part_index,
        otherClueId: hit.other_clue_id,
        otherClueCode: hit.other_clue_code,
        otherPartId: hit.other_part_id,
        otherStatus: hit.other_status,
        selfRatio: hit.self_ratio,
        otherRatio: hit.other_ratio,
        intersectionArea: hit.intersection_area,
      })),
    };
  }

  async applyDecision(write: ClueDecisionWrite): Promise<boolean> {
    // 条件更新：决定与并发写入冲突时这一笔不生效，调用方回 409 concurrent-change。
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE clue SET status = ${write.nextStatus}
      WHERE id = ${write.clueId} AND status = ${write.expectedStatus} AND status = 'pending_decision'
      RETURNING id
    `;
    return rows.length > 0;
  }

  async assignOrg(write: ClueOrgAssignWrite): Promise<boolean> {
    // 条件更新：派机构只允许从待分派池（首次）、已派机构或已派承办人（重新分派）出发；
    // 并发冲突时这一笔不生效，调用方回 409 concurrent-change。
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE clue SET status = 'org_assigned'
      WHERE id = ${write.clueId}
        AND status = ${write.expectedStatus}
        AND status IN ('in_pool', 'org_assigned', 'handler_assigned')
      RETURNING id
    `;
    if (rows.length === 0) return false;
    const now = write.assignedAt;
    await this.prisma.clueAssignment.updateMany({
      where: { clueId: write.clueId, endedAt: null },
      data: { endedAt: now },
    });
    // 换机构后原承办人不再承办：关止原承办人行。
    await this.prisma.clueHandler.updateMany({
      where: { clueId: write.clueId, endedAt: null },
      data: { endedAt: now },
    });
    await this.prisma.clueAssignment.create({
      data: {
        id: write.assignmentId,
        clueId: write.clueId,
        orgUnitId: write.orgUnitId,
        kind: write.kind,
        designate: write.designate,
        assignedBy: write.assignedBy,
        assignedByOrgId: write.assignedByOrgId,
        reason: write.reason,
        assignedAt: now,
      },
    });
    return true;
  }

  async assignPeople(write: CluePeopleAssignWrite): Promise<boolean> {
    // 条件更新：派主办／协办只允许从已派机构出发；并发冲突时这一笔不生效。
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE clue SET status = 'handler_assigned'
      WHERE id = ${write.clueId} AND status = ${write.expectedStatus} AND status = 'org_assigned'
      RETURNING id
    `;
    if (rows.length === 0) return false;
    await this.prisma.clueHandler.updateMany({
      where: { clueId: write.clueId, endedAt: null },
      data: { endedAt: write.assignedAt },
    });
    await this.prisma.clueHandler.createMany({
      data: write.handlers.map((handler) => ({
        id: handler.id,
        clueId: write.clueId,
        personnelId: handler.personnelId,
        role: handler.role,
        assignedAt: write.assignedAt,
      })),
    });
    return true;
  }

  async readWithdrawContext(clueId: string): Promise<ClueWithdrawContext | null> {
    const clue = await this.prisma.clue.findUnique({ where: { id: clueId } });
    if (!clue) return null;
    const hits = await this.prisma.$queryRaw<
      Array<{
        other_clue_id: string;
        other_clue_code: string;
        other_status: string;
        other_handler_org_id: string | null;
      }>
    >`
      SELECT DISTINCT h.other_clue_id,
             c.code AS other_clue_code,
             c.status AS other_status,
             a.org_unit_id AS other_handler_org_id
      FROM clue_spatial_hit h
      JOIN clue c ON c.id = h.other_clue_id
      LEFT JOIN clue_assignment a ON a.clue_id = h.other_clue_id AND a.ended_at IS NULL
      WHERE h.clue_id = ${clueId}
      ORDER BY h.other_clue_id
    `;
    return {
      clueId: clue.id,
      code: clue.code,
      status: clue.status,
      registeredBy: clue.registeredBy,
      enteredOrgId: clue.enteredOrgId,
      hits: hits.map((hit) => ({
        otherClueId: hit.other_clue_id,
        otherClueCode: hit.other_clue_code,
        otherStatus: hit.other_status,
        otherHandlerOrgId: hit.other_handler_org_id,
      })),
    };
  }

  async applyWithdrawal(write: ClueWithdrawWrite): Promise<boolean> {
    // 条件更新：撤回不派只允许从「不派」出发；并发冲突时这一笔不生效，调用方回 409。
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE clue SET status = 'in_pool'
      WHERE id = ${write.clueId} AND status = ${write.expectedStatus} AND status = 'held'
      RETURNING id
    `;
    if (rows.length === 0) return false;
    await this.prisma.clueWithdrawal.create({
      data: {
        id: write.withdrawalId,
        clueId: write.clueId,
        reasonCodes: [...write.reasonCodes],
        note: write.note,
        withdrawnBy: write.withdrawnBy,
        withdrawnAt: write.withdrawnAt,
      },
    });
    // 撤回不派即回答了待处理的结案提醒：业务行随撤回一并了结（提醒由业务表承载，不加留痕）。
    await this.prisma.clueClosureReminder.updateMany({
      where: { clueId: write.clueId, resolvedAt: null },
      data: { resolvedAt: write.withdrawnAt, resolution: 'withdraw' },
    });
    return true;
  }

  /**
   * 结案提醒的待生成对：被结案的线索按当前命中集逐对找出撞上它且当前「不派」的线索。
   * 命中集是双向的，两个方向都认（命中面对不逐面生成提醒，只逐对）。
   */
  async listClosureReminderTargets(closedClueId: string): Promise<readonly ClueClosureReminderTarget[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        clue_id: string;
        clue_code: string;
        other_clue_id: string;
        other_clue_code: string;
        other_status: string;
      }>
    >`
      SELECT DISTINCT c.id AS clue_id,
             c.code AS clue_code,
             ${closedClueId}::text AS other_clue_id,
             (SELECT code FROM clue WHERE id = ${closedClueId}::text) AS other_clue_code,
             (SELECT status FROM clue WHERE id = ${closedClueId}::text) AS other_status
      FROM clue c
      JOIN clue_spatial_hit h
        ON (h.clue_id = c.id AND h.other_clue_id = ${closedClueId}::text)
        OR (h.clue_id = ${closedClueId}::text AND h.other_clue_id = c.id)
      WHERE c.status = 'held'
      ORDER BY c.code
    `;
    return rows.map((row) => ({
      clueId: row.clue_id,
      clueCode: row.clue_code,
      otherClueId: row.other_clue_id,
      otherClueCode: row.other_clue_code,
      otherStatus: row.other_status,
    }));
  }

  /** 写结案提醒行。本期无超期、催办或升级口径：时限不写（due_at 为空）。 */
  async insertClosureReminders(rows: readonly ClueClosureReminderRowToWrite[]): Promise<void> {
    for (const row of rows) {
      await this.prisma.clueClosureReminder.create({
        data: {
          id: row.id,
          clueId: row.clueId,
          kind: row.kind,
          otherClueId: row.otherClueId,
          dueAt: null,
          resolvedAt: null,
          resolution: null,
          createdAt: row.createdAt,
        },
      });
    }
  }

  /**
   * 处置登记：状态条件更新为终态并写入处置行。
   * 起始状态由处置类型定死：不予立案仅已派承办人、随旧线索办结仅不派、移送三个状态都可。
   */
  async applyDisposition(write: ClueDispositionWrite): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE clue SET status = ${write.nextStatus}
      WHERE id = ${write.clueId}
        AND status = ${write.expectedStatus}
        AND (
          (${write.disposition} = 'no-case' AND status = 'handler_assigned')
          OR (${write.disposition} = 'with-old' AND status = 'held')
          OR (${write.disposition} = 'transfer' AND status IN ('in_pool', 'org_assigned', 'handler_assigned'))
        )
      RETURNING id
    `;
    if (rows.length === 0) return false;
    await this.prisma.clueDisposition.create({
      data: {
        id: write.dispositionId,
        clueId: write.clueId,
        disposition: write.disposition,
        transferredOrg: write.transferredOrg,
        documentNo: write.documentNo,
        note: write.note,
        recordedBy: write.recordedBy,
        recordedAt: write.recordedAt,
      },
    });
    return true;
  }

  async readClosureReminder(reminderId: string): Promise<ClueClosureReminderRow | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        clue_id: string;
        clue_code: string;
        kind: string;
        other_clue_id: string | null;
        other_clue_code: string | null;
        other_status: string | null;
        registered_by: string;
        entered_org_id: string;
        other_handler_org_id: string | null;
        created_at: Date;
        resolved_at: Date | null;
        resolution: string | null;
      }>
    >`
      SELECT r.id,
             r.clue_id,
             c.code AS clue_code,
             r.kind,
             r.other_clue_id,
             oc.code AS other_clue_code,
             oc.status AS other_status,
             c.registered_by,
             c.entered_org_id,
             (
               SELECT a.org_unit_id
               FROM clue_assignment a
               WHERE a.clue_id = r.other_clue_id AND a.ended_at IS NULL
               ORDER BY a.assigned_at DESC
               LIMIT 1
             ) AS other_handler_org_id,
             r.created_at,
             r.resolved_at,
             r.resolution
      FROM clue_closure_reminder r
      JOIN clue c ON c.id = r.clue_id
      LEFT JOIN clue oc ON oc.id = r.other_clue_id
      WHERE r.id = ${reminderId}
    `;
    const row = rows[0];
    if (!row) return null;
    return toReminderRow(row);
  }

  /** 未处理的结案提醒：按线索的数据范围（登记机构或承办机构在范围内）过滤。 */
  async listPendingClosureReminders(
    orgUnitIds: readonly string[],
  ): Promise<readonly ClueClosureReminderRow[]> {
    if (orgUnitIds.length === 0) return [];
    const ids = Prisma.join([...orgUnitIds]);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        clue_id: string;
        clue_code: string;
        kind: string;
        other_clue_id: string | null;
        other_clue_code: string | null;
        other_status: string | null;
        registered_by: string;
        entered_org_id: string;
        other_handler_org_id: string | null;
        created_at: Date;
        resolved_at: Date | null;
        resolution: string | null;
      }>
    >`
      SELECT r.id,
             r.clue_id,
             c.code AS clue_code,
             r.kind,
             r.other_clue_id,
             oc.code AS other_clue_code,
             oc.status AS other_status,
             c.registered_by,
             c.entered_org_id,
             (
               SELECT a.org_unit_id
               FROM clue_assignment a
               WHERE a.clue_id = r.other_clue_id AND a.ended_at IS NULL
               ORDER BY a.assigned_at DESC
               LIMIT 1
             ) AS other_handler_org_id,
             r.created_at,
             r.resolved_at,
             r.resolution
      FROM clue_closure_reminder r
      JOIN clue c ON c.id = r.clue_id
      LEFT JOIN clue oc ON oc.id = r.other_clue_id
      WHERE r.resolved_at IS NULL
        AND (
          c.entered_org_id IN (${ids})
          OR EXISTS (
            SELECT 1 FROM clue_assignment a
            WHERE a.clue_id = c.id AND a.ended_at IS NULL AND a.org_unit_id IN (${ids})
          )
        )
      ORDER BY r.created_at DESC, r.id DESC
    `;
    return rows.map(toReminderRow);
  }

  /**
   * 提醒处理：撤回不派再办（回待分派池并写撤回行）或写明原因随旧线索办结（进 closed 并写处置行）；
   * 同时了结该线索未处理的其余结案提醒（提醒挂在该线索上，线索离开「不派」即一并了结）。
   */
  async applyReminderResolution(write: ClueReminderResolveWrite): Promise<boolean> {
    const nextStatus = write.resolution === 'withdraw' ? 'in_pool' : 'closed';
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE clue SET status = ${nextStatus}
      WHERE id = ${write.clueId} AND status = ${write.expectedStatus} AND status = 'held'
      RETURNING id
    `;
    if (rows.length === 0) return false;
    if (write.resolution === 'withdraw' && write.withdrawalId !== null) {
      await this.prisma.clueWithdrawal.create({
        data: {
          id: write.withdrawalId,
          clueId: write.clueId,
          reasonCodes: [...write.reasonCodes],
          note: write.note,
          withdrawnBy: write.resolvedBy,
          withdrawnAt: write.resolvedAt,
        },
      });
    }
    if (write.resolution === 'close-with-old' && write.dispositionId !== null) {
      await this.prisma.clueDisposition.create({
        data: {
          id: write.dispositionId,
          clueId: write.clueId,
          disposition: 'with-old',
          transferredOrg: null,
          documentNo: null,
          note: write.note,
          recordedBy: write.resolvedBy,
          recordedAt: write.resolvedAt,
        },
      });
    }
    await this.prisma.clueClosureReminder.updateMany({
      where: { clueId: write.clueId, resolvedAt: null },
      data: { resolvedAt: write.resolvedAt, resolution: write.resolution },
    });
    return true;
  }

  /** 不派视图：数据范围内当前「不派」的线索。 */
  async listHeldClues(orgUnitIds: readonly string[]): Promise<readonly ClueHeldRow[]> {
    if (orgUnitIds.length === 0) return [];
    const ids = Prisma.join([...orgUnitIds]);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        status: string;
        source_code: string;
        domain: string;
        registered_by: string;
        entered_org_id: string;
        registered_at: Date;
        hit_codes: string[];
        hit_handler_org_ids: string[];
      }>
    >`
      SELECT c.id,
             c.code,
             c.status,
             c.source_code,
             c.domain,
             c.registered_by,
             c.entered_org_id,
             c.registered_at,
             COALESCE(hit.codes, ARRAY[]::text[]) AS hit_codes,
             COALESCE(hit.handler_org_ids, ARRAY[]::text[]) AS hit_handler_org_ids
      FROM clue c
      LEFT JOIN (
        SELECT h.clue_id,
               array_agg(DISTINCT oc.code) AS codes,
               array_agg(DISTINCT a.org_unit_id) FILTER (WHERE a.org_unit_id IS NOT NULL) AS handler_org_ids
        FROM clue_spatial_hit h
        JOIN clue oc ON oc.id = h.other_clue_id
        LEFT JOIN clue_assignment a ON a.clue_id = h.other_clue_id AND a.ended_at IS NULL
        GROUP BY h.clue_id
      ) hit ON hit.clue_id = c.id
      WHERE c.status = 'held'
        AND (
          c.entered_org_id IN (${ids})
          OR EXISTS (
            SELECT 1 FROM clue_assignment a
            WHERE a.clue_id = c.id AND a.ended_at IS NULL AND a.org_unit_id IN (${ids})
          )
        )
      ORDER BY c.registered_at DESC, c.id DESC
    `;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      sourceCode: row.source_code,
      domain: row.domain,
      registeredBy: row.registered_by,
      enteredOrgId: row.entered_org_id,
      registeredAt: row.registered_at,
      hitCodes: row.hit_codes ?? [],
      hitHandlerOrgIds: row.hit_handler_org_ids ?? [],
    }));
  }

  /** 业务编号：取库内 sequence 的下一个值（迁移创建，不算 model）。 */
  private async nextCode(): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('clue_code_seq') AS nextval
    `;
    const value = rows[0]?.nextval;
    if (value === undefined) throw new Error('线索编号序列未返回取值');
    return formatClueCode(value);
  }

  /**
   * 标签 create-on-use：库里没有的当场新建，共享库随登记留痕。
   * 已有同名标签时只挂线索，不新建库行。
   */
  private async insertTags(
    clueId: string,
    tags: readonly { id: string; libraryId: string; name: string }[],
  ): Promise<void> {
    if (tags.length === 0) return;
    const names = tags.map((tag) => tag.name);
    const existing = await this.prisma.clueTagLibrary.findMany({ where: { name: { in: names } } });
    const known = new Set(existing.map((row) => row.name));
    const fresh = tags.filter((tag) => !known.has(tag.name));
    if (fresh.length > 0) {
      await this.prisma.clueTagLibrary.createMany({
        data: fresh.map((tag) => ({ id: tag.libraryId, name: tag.name })),
      });
    }
    await this.prisma.clueTag.createMany({
      data: tags.map((tag) => ({ id: tag.id, clueId, libraryId: tag.libraryId, name: tag.name })),
    });
  }

  /** 空间对象与部件：几何走 $queryRaw，坐标由 4326 转到 4490，来源 SRID 与来源几何原样保留。 */
  private async insertSpatial(
    clueId: string,
    domain: string,
    spatial: ClueRegistrationWrite['spatial'],
  ): Promise<void> {
    await this.prisma.$queryRaw`
      INSERT INTO clue_spatial_object (id, clue_id, domain, kind, part_count, dup_computed_at, created_at)
      VALUES (${spatial.id}, ${clueId}, ${domain}, ${spatial.kind}, ${spatial.parts.length}, now(), now())
    `;
    for (const part of spatial.parts) {
      await this.insertSpatialPart(spatial.id, part);
    }
  }

  private async insertSpatialPart(spatialObjectId: string, part: ClueSpatialPartRow): Promise<void> {
    await this.prisma.$queryRaw`
      INSERT INTO clue_spatial_part (id, spatial_object_id, part_index, geom, source_srid, source_geom, created_at)
      VALUES (
        ${part.id}, ${spatialObjectId}, ${part.partIndex},
        ST_Transform(ST_GeomFromGeoJSON(${part.geojson}), ${TARGET_SRID}::integer),
        ${part.sourceSrid}::integer,
        ST_GeomFromGeoJSON(${part.geojson}),
        now()
      )
    `;
  }

  /**
   * 逐面比对：与未结案线索的每个面对分别算交集，双方各自以单面 geography 面积作分母，
   * 任一方达到阈值即该面对命中。点状不参与（本方法只对面状调用）。
   */
  private async computeHits(parts: readonly ClueSpatialPartRow[]): Promise<ClueHitSummary[]> {
    if (parts.length === 0) return [];
    const payload = JSON.stringify(
      parts.map((part) => ({ partIndex: part.partIndex, id: part.id, geojson: part.geojson })),
    );
    const rows = await this.prisma.$queryRaw<OverlapRow[]>`
      WITH new_part AS (
        SELECT (part->>'partIndex')::int AS part_index,
               (part->>'id')::text AS part_id,
               ST_Transform(ST_GeomFromGeoJSON(part->>'geojson'), ${TARGET_SRID}::integer) AS geom
        FROM jsonb_array_elements(${payload}::jsonb) AS part
      ),
      other_part AS (
        SELECT c.id AS clue_id, c.code AS clue_code, p.id AS part_id, p.geom
        FROM clue_spatial_part p
        JOIN clue_spatial_object o ON o.id = p.spatial_object_id
        JOIN clue c ON c.id = o.clue_id
        WHERE c.status NOT IN (${Prisma.join(NOT_COMPARABLE_STATUSES)})
      ),
      overlap AS (
        SELECT np.part_index, np.part_id, op.clue_id, op.clue_code, op.part_id AS other_part_id,
               ST_Area(ST_Intersection(np.geom, op.geom)::geography) AS inter_area,
               ST_Area(np.geom::geography) AS self_area,
               ST_Area(op.geom::geography) AS other_area
        FROM new_part np
        JOIN other_part op ON ST_Intersects(np.geom, op.geom)
      )
      SELECT part_index, part_id, clue_id, clue_code, other_part_id, inter_area, self_area, other_area
      FROM overlap
      WHERE inter_area > 0
        AND (
          inter_area / NULLIF(self_area, 0) >= ${DUPLICATE_OVERLAP_THRESHOLD}::double precision
          OR inter_area / NULLIF(other_area, 0) >= ${DUPLICATE_OVERLAP_THRESHOLD}::double precision
        )
    `;
    return rows.map((row) => ({
      partId: row.part_id,
      partIndex: row.part_index,
      otherClueId: row.clue_id,
      otherClueCode: row.clue_code,
      otherPartId: row.other_part_id,
      selfRatio: row.self_area > 0 ? row.inter_area / row.self_area : 0,
      otherRatio: row.other_area > 0 ? row.inter_area / row.other_area : 0,
      intersectionArea: row.inter_area,
    }));
  }
}

/** JSON 文本列解析。解析不出或不是对象即 null。 */
function parseJson<T>(text: string | null): T | null {
  if (text === null || text === '') return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** 缺图层列：一组键。解析不出即空。 */
function parseJsonArray(text: string | null): readonly string[] {
  if (text === null || text === '') return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** 运行行 → 端口形状。状态与失败类别的取值由库内 CHECK 约束守着。 */
function toRunRow(row: {
  id: string;
  clueId: string;
  runNo: number;
  status: string;
  attemptsUsed: number;
  trigger: string;
  failureCategory: string | null;
  missingLayers: string | null;
  layersJson: string | null;
  artifactsJson: string | null;
  startedAt: Date;
  endedAt: Date | null;
}): ClueVerificationRunRow {
  return {
    id: row.id,
    clueId: row.clueId,
    runNo: row.runNo,
    status: row.status as ClueVerificationRunRow['status'],
    attemptsUsed: row.attemptsUsed,
    trigger: row.trigger as ClueVerificationRunRow['trigger'],
    failureCategory:
      row.failureCategory === null
        ? null
        : (row.failureCategory as ClueVerificationRunRow['failureCategory']),
    missingLayers: parseJsonArray(row.missingLayers),
    layers: parseJson<VerificationLayerResult[]>(row.layersJson) ?? [],
    artifacts: parseJson<ClueVerificationArtifacts>(row.artifactsJson),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

/** 结案提醒行 → 端口形状。 */
function toReminderRow(row: {
  id: string;
  clue_id: string;
  clue_code: string;
  kind: string;
  other_clue_id: string | null;
  other_clue_code: string | null;
  other_status: string | null;
  registered_by: string;
  entered_org_id: string;
  other_handler_org_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolution: string | null;
}): ClueClosureReminderRow {
  return {
    id: row.id,
    clueId: row.clue_id,
    clueCode: row.clue_code,
    kind: row.kind,
    otherClueId: row.other_clue_id,
    otherClueCode: row.other_clue_code,
    otherStatus: row.other_status,
    registeredBy: row.registered_by,
    enteredOrgId: row.entered_org_id,
    otherHandlerOrgId: row.other_handler_org_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}
