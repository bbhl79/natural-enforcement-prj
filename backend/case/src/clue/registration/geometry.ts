// 几何解析（#211；规格 B）。
//
// 口径：
// - 法域定几何：土地/矿产＝面，测绘/规划＝点（业务口径）。
// - 只接受 EPSG:4326 输入，由服务端转换到 EPSG:4490；其他坐标系拒绝。原始 SRID 与原始几何保留。
// - 土地/矿产的 GeoJSON 含多个面时，合并为该线索的多个面部件（一次登记只建一条线索）。
// - 测绘/规划只接受一个点位：多点或点面混合拒绝。
//
// 本文件只做纯解析与判定：产物是「每个面部件的 GeoJSON 几何文本」，入库时的
// ST_GeomFromGeoJSON + ST_Transform 由 case 内的空间写入口径执行。

import type { Domain } from '../requirements/types.ts';

/** 允许的输入坐标系。入库统一 EPSG:4490（CGCS2000 地理坐标系）。 */
export const ALLOWED_INPUT_SRID = 4326;

/** 几何形态。 */
export type SpatialKind = 'face' | 'point';

/** 一个几何部件。 */
export interface SpatialPart {
  /** 部件序号（同一线索内从 0 递增）。 */
  readonly partIndex: number;
  /** 该部件的 GeoJSON 几何文本（形如 {"type":"Polygon","coordinates":[…]}）。 */
  readonly geojson: string;
}

/** 解析结果。失败时带规则码（进 400 响应的 rules）。 */
export type SpatialParseOutcome =
  | {
      readonly ok: true;
      readonly kind: SpatialKind;
      readonly parts: readonly SpatialPart[];
      readonly sourceSrid: number;
    }
  | { readonly ok: false; readonly rule: string; readonly message: string };

/** 解析输入。 */
export interface SpatialParseInput {
  /** GeoJSON 文本。 */
  readonly text: string;
  /** 法域短码。 */
  readonly domain: Domain;
  /** 声明的输入坐标系。 */
  readonly srid: number;
}

interface GeoJsonGeometry {
  readonly type: string;
  readonly coordinates?: unknown;
}

function fail(rule: string, message: string): SpatialParseOutcome {
  return { ok: false, rule, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readGeometry(value: unknown): GeoJsonGeometry | null {
  if (!isRecord(value)) return null;
  const type = value['type'];
  if (typeof type !== 'string') return null;
  if (type !== 'Polygon' && type !== 'MultiPolygon' && type !== 'Point' && type !== 'MultiPoint') return null;
  if (!Array.isArray(value['coordinates'])) return null;
  return { type, coordinates: value['coordinates'] };
}

/** 从 Feature / FeatureCollection / 裸几何里取出全部几何。 */
function collectGeometries(root: unknown): GeoJsonGeometry[] | null {
  if (!isRecord(root)) return null;
  const type = root['type'];
  if (type === 'FeatureCollection') {
    const features = root['features'];
    if (!Array.isArray(features)) return null;
    const geometries: GeoJsonGeometry[] = [];
    for (const feature of features) {
      if (!isRecord(feature) || feature['type'] !== 'Feature') return null;
      const geometry = readGeometry(feature['geometry']);
      if (geometry === null) return null;
      geometries.push(geometry);
    }
    return geometries;
  }
  if (type === 'Feature') {
    const geometry = readGeometry(root['geometry']);
    return geometry === null ? null : [geometry];
  }
  const geometry = readGeometry(root);
  return geometry === null ? null : [geometry];
}

/** GeoJSON 的 crs 成员：只认 4326（RFC 7946 一律 WGS84；显式写别的坐标系即拒绝）。 */
function crsSrid(root: unknown): number | null {
  if (!isRecord(root)) return null;
  const crs = root['crs'];
  if (crs === undefined) return null;
  if (!isRecord(crs)) return Number.NaN;
  const properties = crs['properties'];
  if (!isRecord(properties)) return Number.NaN;
  const name = properties['name'];
  if (typeof name !== 'string') return Number.NaN;
  const matched = /epsg[:\s]*(\d+)/i.exec(name);
  if (matched !== null) return Number.parseInt(matched[1] as string, 10);
  if (/crs84/i.test(name)) return ALLOWED_INPUT_SRID;
  return Number.NaN;
}

function polygonParts(geometries: readonly GeoJsonGeometry[]): string[] | null {
  const parts: string[] = [];
  for (const geometry of geometries) {
    if (geometry.type === 'Polygon') {
      parts.push(JSON.stringify({ type: 'Polygon', coordinates: geometry.coordinates }));
      continue;
    }
    if (geometry.type === 'MultiPolygon') {
      const coordinates = geometry.coordinates as unknown[];
      for (const polygon of coordinates) {
        if (!Array.isArray(polygon)) return null;
        parts.push(JSON.stringify({ type: 'Polygon', coordinates: polygon }));
      }
      continue;
    }
    return null;
  }
  return parts;
}

/**
 * 解析几何来源文件。
 * 面域：一个或多个面部件（Polygon 逐个拆开，MultiPolygon 拆成多个 Polygon）。
 * 点域：恰好一个点（MultiPoint 与点面混合都拒绝）。
 */
export function parseSpatialSource(input: SpatialParseInput): SpatialParseOutcome {
  if (input.srid !== ALLOWED_INPUT_SRID) {
    return fail('spatial-srid-rejected', `只接受 EPSG:${ALLOWED_INPUT_SRID} 输入，收到 ${input.srid}`);
  }
  let root: unknown;
  try {
    root = JSON.parse(input.text);
  } catch {
    return fail('spatial-source-unparsable', '几何来源文件不是合法 JSON');
  }
  const declared = crsSrid(root);
  if (declared !== null) {
    if (Number.isNaN(declared)) return fail('spatial-srid-rejected', '几何来源文件声明的坐标系无法识别');
    if (declared !== ALLOWED_INPUT_SRID) {
      return fail('spatial-srid-rejected', `只接受 EPSG:${ALLOWED_INPUT_SRID} 输入，收到 ${declared}`);
    }
  }
  const geometries = collectGeometries(root);
  if (geometries === null) {
    return fail('spatial-source-unparsable', '几何来源文件不是可识别的 GeoJSON');
  }
  if (geometries.length === 0) {
    return fail('spatial-geometry-empty', '几何来源文件没有几何');
  }
  const faceDomain = input.domain === 'land' || input.domain === 'mineral';
  if (faceDomain) {
    const parts = polygonParts(geometries);
    if (parts === null) {
      return fail('spatial-geometry-type-rejected', '土地与矿产线索只接受面状几何');
    }
    return {
      ok: true,
      kind: 'face',
      sourceSrid: input.srid,
      parts: parts.map((geojson, partIndex) => ({ partIndex, geojson })),
    };
  }
  if (geometries.length !== 1) {
    return fail('spatial-geometry-type-rejected', '测绘与规划线索只接受一个点位');
  }
  const only = geometries[0] as GeoJsonGeometry;
  if (only.type !== 'Point') {
    return fail('spatial-geometry-type-rejected', '测绘与规划线索只接受一个点位');
  }
  return {
    ok: true,
    kind: 'point',
    sourceSrid: input.srid,
    parts: [{ partIndex: 0, geojson: JSON.stringify({ type: 'Point', coordinates: only.coordinates }) }],
  };
}
