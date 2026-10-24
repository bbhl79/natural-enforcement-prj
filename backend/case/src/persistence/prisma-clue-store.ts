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

import { ClueIdempotencyConflictError } from './clue-store.ts';
import type {
  ClueHitSummary,
  ClueHitWrite,
  ClueIdempotencyRow,
  ClueRegistrationOutcome,
  ClueRegistrationResult,
  ClueRegistrationWrite,
  ClueSpatialPartRow,
  ClueStore,
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
