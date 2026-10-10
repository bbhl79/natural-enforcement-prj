// 土地/矿产法域几何存取（#54 法域定几何：土地/矿产=面 Polygon）：
// geom 列一律 ST_Transform 至 CGCS2000（EPSG:4490）落库；来源坐标（WKT + 来源 SRID）
// 原样另列保留。含必填空间字段的表禁用 ORM create/update（infra/VERSIONS.md 执行纪律 2），
// 全部走 $queryRaw/ST_ 函数；法域→几何类型映射由库内 CHECK 约束承载。
import { CGCS2000_SRID } from './constants.ts';
import type { SqlClient } from './sql-client.ts';

export type LandBoundaryDomain = 'land' | 'mineral';

export interface LandBoundaryInput {
  name: string;
  domain: LandBoundaryDomain;
  sourceWkt: string;
  sourceSrid: number;
}

export interface LandBoundaryRow {
  id: number;
  name: string;
  domain: LandBoundaryDomain;
  cgcs2000Wkt: string;
  cgcs2000Srid: number;
  geometryType: string;
  sourceSrid: number;
  sourceWkt: string;
}

export async function insertLandBoundary(db: SqlClient, input: LandBoundaryInput): Promise<number> {
  const rows = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO geo_dict_land_boundary (name, domain, geom, source_srid, source_geom)
    VALUES (${input.name}, ${input.domain},
            ST_Transform(ST_GeomFromText(${input.sourceWkt}, ${input.sourceSrid}::integer), ${CGCS2000_SRID}::integer),
            ${input.sourceSrid},
            ST_GeomFromText(${input.sourceWkt}, ${input.sourceSrid}::integer))
    RETURNING id`;
  return rows[0].id;
}

export async function findLandBoundaryById(db: SqlClient, id: number): Promise<LandBoundaryRow | null> {
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
export async function deleteLandBoundaryById(db: SqlClient, id: number): Promise<void> {
  await db.$queryRaw`
    DELETE FROM geo_dict_land_boundary WHERE id = ${id}`;
}
