// 用途：土地、矿产法域的面几何（表 geo_dict_land_boundary）的写入、按主键读取与按主键删除。
// 调用方：当前仅 integration/e4-coordinate-roundtrip.test.ts，经公共出口 backend/geo-dict/src/index.ts。
// 边界：不属 ADR 0016 的参照数据；表无防改删触发器，可 DELETE。本文件只经 $queryRaw 读写，不用 ORM。
// 依据：#54；表定义见 GeoDictLandBoundary（backend/prisma/schema.prisma）。
// 土地/矿产法域几何存取（#54 法域定几何：土地/矿产=面 Polygon）：
// geom 列一律 ST_Transform 至 CGCS2000（EPSG:4490）落库；来源坐标（WKT + 来源 SRID）
// 原样另列保留。含必填空间字段的表禁用 ORM create/update（infra/VERSIONS.md 执行纪律 2），
// 全部走 $queryRaw/ST_ 函数；法域→几何类型映射由库内 CHECK 约束承载。
import { newUlid } from '@natural-enforcement/shield';
import { CGCS2000_SRID } from './constants.ts';
import type { SqlClient } from './sql-client.ts';

// 面几何所属法域：land 为土地，mineral 为矿产；与库内 geo_dict_land_boundary_domain_check 取值一致。
export type LandBoundaryDomain = 'land' | 'mineral';

// 写入入参：来源坐标 WKT 与来源 SRID 由调用方提供，函数负责换算到 CGCS2000 后落 geom 列。
export interface LandBoundaryInput {
  name: string;
  domain: LandBoundaryDomain;
  sourceWkt: string;
  sourceSrid: number;
}

// 读取结果：geom 以 WKT 文本输出（cgcs2000Wkt），来源坐标原样另列返回（sourceWkt、sourceSrid）。
export interface LandBoundaryRow {
  id: string;
  name: string;
  domain: LandBoundaryDomain;
  cgcs2000Wkt: string;
  cgcs2000Srid: number;
  geometryType: string;
  sourceSrid: number;
  sourceWkt: string;
}

// 插入一条面几何并返回新生成的 ULID 主键：geom 经 ST_Transform 存为 4490，来源几何与来源 SRID 原样另列保存。
// 失败语义：几何类型或 domain 不满足库内约束（geom 列为 Polygon，domain 限 land、mineral）时由数据库抛错，本函数不捕获。
export async function insertLandBoundary(db: SqlClient, input: LandBoundaryInput): Promise<string> {
  const id = newUlid();
  await db.$queryRaw`
    INSERT INTO geo_dict_land_boundary (id, name, domain, geom, source_srid, source_geom)
    VALUES (${id}, ${input.name}, ${input.domain},
            ST_Transform(ST_GeomFromText(${input.sourceWkt}, ${input.sourceSrid}::integer), ${CGCS2000_SRID}::integer),
            ${input.sourceSrid},
            ST_GeomFromText(${input.sourceWkt}, ${input.sourceSrid}::integer))`;
  return id;
}

// 按主键读取一条面几何；找不到返回 null，不抛错。
export async function findLandBoundaryById(db: SqlClient, id: string): Promise<LandBoundaryRow | null> {
  const rows = await db.$queryRaw<LandBoundaryRow[]>`
    SELECT id, name, domain,
           ST_AsText(geom) AS "cgcs2000Wkt",
           ST_SRID(geom) AS "cgcs2000Srid",
           ST_GeometryType(geom) AS "geometryType",
           source_srid AS "sourceSrid",
           ST_AsText(source_geom) AS "sourceWkt"
    FROM geo_dict_land_boundary
    WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** 仅限测试自清理等运维场景；业务语义删除不在本切片范围 */
export async function deleteLandBoundaryById(db: SqlClient, id: string): Promise<void> {
  await db.$queryRaw`
    DELETE FROM geo_dict_land_boundary WHERE id = ${id}`;
}
