// 统一坐标口径载体（#54）：CGCS2000 地理坐标系 EPSG:4490，全系统唯一坐标口径。
// 来源坐标原样保留（来源坐标系代码 + 坐标值），CGCS2000 坐标一律经 ST_Transform 落库；
// 往返转换（来源→CGCS2000→来源）同一输入恒定输出（E4 断言）。
// EPSG:4490 具体选择为执行者补的定案空档，留痕请定案复核（#54 评论）。
import { CGCS2000_SRID } from './constants.ts';
import type { SqlClient } from './sql-client.ts';

/** 来源坐标 → CGCS2000（EPSG:4490）WKT；不写库，纯转换，可复现性由调用方断言 */
export async function sourceToCgcs2000(
  db: SqlClient,
  sourceWkt: string,
  sourceSrid: number,
  maxDigits = 15,
): Promise<string> {
  const rows = await db.$queryRaw<{ wkt: string }[]>`
    SELECT ST_AsText(ST_Transform(ST_GeomFromText(${sourceWkt}, ${sourceSrid}::integer), ${CGCS2000_SRID}::integer), ${maxDigits}::integer) AS wkt`;
  return rows[0].wkt;
}

/**
 * CGCS2000（EPSG:4490）WKT → 目标来源坐标系 WKT；与 sourceToCgcs2000 构成往返。
 * maxDigits 为 ST_AsText 输出精度：正逆投影往返存在 ~1e-9 米级浮差，
 * 6 位小数（微米级）下与来源坐标严格一致（E4 断言口径）。
 * SRID 参数一律 ::integer 显式转型：ST_Transform 有 (geometry, text) 重载，
 * 参数不按整型解析时会被当成 proj 字符串（实测：could not parse proj string '4490'）。
 */
export async function cgcs2000ToSource(
  db: SqlClient,
  cgcs2000Wkt: string,
  targetSrid: number,
  maxDigits = 15,
): Promise<string> {
  const rows = await db.$queryRaw<{ wkt: string }[]>`
    SELECT ST_AsText(ST_Transform(ST_GeomFromText(${cgcs2000Wkt}, ${CGCS2000_SRID}::integer), ${targetSrid}::integer), ${maxDigits}::integer) AS wkt`;
  return rows[0].wkt;
}
