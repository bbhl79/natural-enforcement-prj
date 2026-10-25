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
import { isAnonymousValue } from '../clue/registration/rules.ts';
import {
  DUPLICATE_OVERLAP_THRESHOLD,
  NOT_COMPARABLE_CLUE_STATUSES,
} from '../clue/duplicate/rules.ts';
import { ClueIdempotencyConflictError, ClueVerificationRunningError } from './clue-store.ts';
import type {
  ClueDuplicateContext,
  ClueDuplicatePeer,
  ClueDecisionWrite,
  ClueDispatchContext,
  ClueGapFillOutcome,
  ClueGapFillWrite,
  ClueItemGapRow,
  ClueHitSummary,
  ClueHitWrite,
  ClueIdempotencyRow,
  ClueOrgAssignWrite,
  CluePeopleAssignWrite,
  ClueRegistrationOutcome,
  ClueRegistrationResult,
  ClueRegistrationWrite,
  ClueSpatialPartRow,
  ClueStore,
  ClueVerificationArtifacts,
  ClueVerificationContext,
  ClueVerificationFinishWrite,
  ClueVerificationRunRow,
  ClueVerificationRunWrite,
} from './clue-store.ts';

/** Prisma 根客户端，或一个交互式事务客户端。 */
type Db = PrismaClient | Prisma.TransactionClient;

/** 入库统一坐标口径：EPSG:4490（CGCS2000 地理坐标系）。 */
const TARGET_SRID = 4490;

/** 退出比对的线索状态取自领域规则（#212）：结案与已移送退出，已立案仍参与。 */
const NOT_COMPARABLE_STATUSES: readonly string[] = NOT_COMPARABLE_CLUE_STATUSES;

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

/** 匿名取值文本是否为「是」；空值即否。 */
function isAnonymousText(value: string | null | undefined): boolean {
  return typeof value === 'string' && isAnonymousValue(value);
}

interface OverlapRow {
  part_index: number;
  part_id: string;
  clue_id: string;
  clue_code: string;
  other_part_id: string;
  other_part_index: number;
  inter_area: number;
  self_area: number;
  other_area: number;
  self_geojson: string;
  other_geojson: string;
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
    return {
      id: clue.id,
      code: clue.code,
      status: clue.status,
      gaps: gaps.map((gap) => ({ key: gap.key, label: gap.label })),
      hits: await this.listHitSummaries(clueId),
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

  async readDuplicateContext(clueId: string): Promise<ClueDuplicateContext | null> {
    const clue = await this.prisma.clue.findUnique({
      where: { id: clueId },
      select: {
        id: true,
        code: true,
        domain: true,
        sourceCode: true,
        registeredAt: true,
        anonymityConfirmed: true,
        status: true,
        registeredBy: true,
        enteredOrgId: true,
        verificationStatus: true,
      },
    });
    if (!clue) return null;
    const object = await this.prisma.clueSpatialObject.findUnique({ where: { clueId } });
    if (!object) return null;
    const parts = await this.prisma.$queryRaw<
      Array<{ part_id: string; part_index: number; geojson: string }>
    >`
      SELECT id AS part_id, part_index, ST_AsGeoJSON(geom) AS geojson
      FROM clue_spatial_part
      WHERE spatial_object_id = ${object.id}
      ORDER BY part_index
    `;
    const assignments = await this.prisma.clueAssignment.findMany({
      where: { clueId, endedAt: null },
      select: { orgUnitId: true },
    });
    return {
      clueId: clue.id,
      code: clue.code,
      domain: clue.domain,
      sourceCode: clue.sourceCode,
      registeredAt: clue.registeredAt,
      anonymityConfirmed: clue.anonymityConfirmed,
      status: clue.status,
      registeredBy: clue.registeredBy,
      enteredOrgId: clue.enteredOrgId,
      assignedOrgUnitIds: [...new Set(assignments.map((row) => row.orgUnitId))],
      verificationStatus: clue.verificationStatus,
      spatialKind: object.kind === 'point' ? 'point' : 'face',
      parts: parts.map((part) => ({
        partId: part.part_id,
        partIndex: part.part_index,
        geojson: part.geojson,
      })),
      hits: await this.listHitSummaries(clueId),
      dupComputedAt: object.dupComputedAt,
    };
  }

  async listHitSummaries(clueId: string): Promise<ClueHitSummary[]> {
    const hits = await this.prisma.$queryRaw<
      Array<{
        part_id: string;
        part_index: number;
        other_clue_id: string;
        other_clue_code: string;
        other_part_id: string;
        other_part_index: number;
        self_ratio: number;
        other_ratio: number;
        intersection_area: number;
        self_geojson: string;
        other_geojson: string;
      }>
    >`
      SELECT h.spatial_part_id AS part_id,
             p.part_index,
             h.other_clue_id,
             c.code AS other_clue_code,
             h.other_part_id,
             op.part_index AS other_part_index,
             h.self_ratio,
             h.other_ratio,
             h.intersection_area,
             ST_AsGeoJSON(p.geom) AS self_geojson,
             ST_AsGeoJSON(op.geom) AS other_geojson
      FROM clue_spatial_hit h
      JOIN clue c ON c.id = h.other_clue_id
      JOIN clue_spatial_part p ON p.id = h.spatial_part_id
      JOIN clue_spatial_part op ON op.id = h.other_part_id
      WHERE h.clue_id = ${clueId}
      ORDER BY h.other_clue_id, p.part_index
    `;
    return hits.map((hit) => ({
      partId: hit.part_id,
      partIndex: hit.part_index,
      otherClueId: hit.other_clue_id,
      otherClueCode: hit.other_clue_code,
      otherPartId: hit.other_part_id,
      otherPartIndex: hit.other_part_index,
      selfRatio: hit.self_ratio,
      otherRatio: hit.other_ratio,
      intersectionArea: hit.intersection_area,
      selfGeojson: hit.self_geojson,
      otherGeojson: hit.other_geojson,
    }));
  }

  async computeHitsForClue(clueId: string): Promise<ClueHitSummary[]> {
    const parts = await this.prisma.$queryRaw<
      Array<{ id: string; part_index: number; geojson: string }>
    >`
      SELECT p.id, p.part_index, ST_AsGeoJSON(p.geom) AS geojson
      FROM clue_spatial_part p
      JOIN clue_spatial_object o ON o.id = p.spatial_object_id
      WHERE o.clue_id = ${clueId}
      ORDER BY p.part_index
    `;
    if (parts.length === 0) return [];
    const object = await this.prisma.clueSpatialObject.findUnique({ where: { clueId } });
    if (object?.kind !== 'face') return [];
    return this.computeHits(
      parts.map((part) => ({
        id: part.id,
        partIndex: part.part_index,
        geojson: part.geojson,
        sourceSrid: TARGET_SRID,
      })),
      clueId,
    );
  }

  async replaceHitSet(clueId: string, hits: readonly ClueHitWrite[]): Promise<void> {
    // 整体替换：涉及该线索的正向与反向命中行全部删掉（命中行外键挂双方部件）。
    await this.prisma.$queryRaw`
      DELETE FROM clue_spatial_hit WHERE clue_id = ${clueId} OR other_clue_id = ${clueId}
    `;
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
    await this.prisma.$queryRaw`
      UPDATE clue_spatial_object SET dup_computed_at = now() WHERE clue_id = ${clueId}
    `;
  }

  async replaceSpatialParts(clueId: string, parts: readonly ClueSpatialPartRow[]): Promise<void> {
    const object = await this.prisma.clueSpatialObject.findUnique({ where: { clueId } });
    if (!object) throw new Error('线索没有空间对象');
    await this.prisma.$queryRaw`
      DELETE FROM clue_spatial_part WHERE spatial_object_id = ${object.id}
    `;
    for (const part of parts) {
      await this.insertSpatialPart(object.id, part);
    }
    await this.prisma.$queryRaw`
      UPDATE clue_spatial_object
      SET part_count = ${parts.length}, dup_computed_at = now()
      WHERE id = ${object.id}
    `;
  }

  async updateClueStatus(clueId: string, status: string): Promise<void> {
    await this.prisma.clue.update({ where: { id: clueId }, data: { status } });
  }

  async readItemValues(clueId: string): Promise<Readonly<Record<string, string | null>>> {
    const rows = await this.prisma.clueItemValue.findMany({ where: { clueId } });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async readDuplicatePeers(peerIds: readonly string[]): Promise<ReadonlyMap<string, ClueDuplicatePeer>> {
    const peers = new Map<string, ClueDuplicatePeer>();
    if (peerIds.length === 0) return peers;
    const clues = await this.prisma.clue.findMany({ where: { id: { in: [...peerIds] } } });
    const values = await this.prisma.clueItemValue.findMany({
      where: { clueId: { in: [...peerIds] }, key: { in: ['clue.location', 'clue.reporter_name', 'clue.reporter_contact', 'clue.reporter_anonymous'] } },
    });
    const valueOf = new Map<string, Map<string, string | null>>();
    for (const row of values) {
      const bucket = valueOf.get(row.clueId) ?? new Map<string, string | null>();
      bucket.set(row.key, row.value);
      valueOf.set(row.clueId, bucket);
    }
    for (const clue of clues) {
      const bucket = valueOf.get(clue.id) ?? new Map<string, string | null>();
      peers.set(clue.id, {
        clueId: clue.id,
        code: clue.code,
        status: clue.status,
        registeredAt: clue.registeredAt,
        sourceCode: clue.sourceCode,
        anonymityConfirmed: clue.anonymityConfirmed,
        location: bucket.get('clue.location') ?? null,
        reporterName: bucket.get('clue.reporter_name') ?? null,
        reporterContact: bucket.get('clue.reporter_contact') ?? null,
        reporterAnonymous: isAnonymousText(bucket.get('clue.reporter_anonymous')),
      });
    }
    return peers;
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
   * 任一方达到阈值即该面对命中。点状不参与（调用方只对面状调用）。
   * excludeClueId 用于重算时排除自己（重绘后正式计算）。
   */
  private async computeHits(
    parts: readonly ClueSpatialPartRow[],
    excludeClueId: string | null = null,
  ): Promise<ClueHitSummary[]> {
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
        SELECT c.id AS clue_id, c.code AS clue_code, p.id AS part_id, p.part_index, p.geom
        FROM clue_spatial_part p
        JOIN clue_spatial_object o ON o.id = p.spatial_object_id
        JOIN clue c ON c.id = o.clue_id
        WHERE o.kind = 'face'
          AND c.status NOT IN (${Prisma.join(NOT_COMPARABLE_STATUSES)})
          AND (${excludeClueId}::text IS NULL OR c.id <> ${excludeClueId}::text)
      ),
      overlap AS (
        SELECT np.part_index, np.part_id, op.clue_id, op.clue_code, op.part_id AS other_part_id,
               op.part_index AS other_part_index,
               ST_Area(ST_Intersection(np.geom, op.geom)::geography) AS inter_area,
               ST_Area(np.geom::geography) AS self_area,
               ST_Area(op.geom::geography) AS other_area,
               ST_AsGeoJSON(np.geom) AS self_geojson,
               ST_AsGeoJSON(op.geom) AS other_geojson
        FROM new_part np
        JOIN other_part op ON ST_Intersects(np.geom, op.geom)
      )
      SELECT part_index, part_id, clue_id, clue_code, other_part_id, other_part_index,
             inter_area, self_area, other_area, self_geojson, other_geojson
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
      otherPartIndex: row.other_part_index,
      selfRatio: row.self_area > 0 ? row.inter_area / row.self_area : 0,
      otherRatio: row.other_area > 0 ? row.inter_area / row.other_area : 0,
      intersectionArea: row.inter_area,
      selfGeojson: row.self_geojson,
      otherGeojson: row.other_geojson,
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
