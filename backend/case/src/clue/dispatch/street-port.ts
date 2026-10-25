// 街道镇边界查询端口（#214；规格 C 节「辖区建议」、ADR 0021）。
//
// 辖区建议由分派流程服务端现算：面状逐面、点状按包含点位，向街道镇边界服务远程实时查询，
// 本地不落图层副本。服务契约与核查图层服务一致（见 verification/layer-service-port.ts）：
//   GET {服务地址}?layer=street-boundary&geometry={一个部件的 GeoJSON}&srid=4490
//   每个要素的 id（或 properties.id）即街道编码，properties.intersection 为相交多边形，
//   properties.overlap_area 为相交面积（平方米）；缺任一必填项即视为返回不合规。
//
// 端口不暴露任何图层服务客户端类型：出参只有事实（街道编码、相交面积、相交多边形）。
// 服务未配置、不可用、超时或返回不合规时给出原因词，调用方返回空建议、不拦手工分派。

/** 注入令牌。 */
export const STREET_BOUNDARY_PORT = Symbol('STREET_BOUNDARY_PORT');

/** 一次查询的一个几何部件（EPSG:4490 GeoJSON 文本）。面状逐面各查一次（街道明细按面汇总）。 */
export interface StreetBoundaryPart {
  readonly partId: string;
  readonly partIndex: number;
  readonly geojson: string;
}

/** 一次辖区建议的查询入参。 */
export interface StreetBoundaryRequest {
  readonly clueId: string;
  /** 几何形态：face 面状（只取相交面积 > 0 的街道）；point 点状（返回的街道即包含点位的街道）。 */
  readonly kind: 'face' | 'point';
  readonly parts: readonly StreetBoundaryPart[];
}

/** 一个相交要素的事实。 */
export interface StreetFeature {
  /** 街道编码（图层服务给的要素标识；辖区对应按它映射机构）。 */
  readonly streetCode: string;
  /** 该相交的部件（面状街道明细按部件归组）。 */
  readonly partId: string;
  readonly partIndex: number;
  /** 相交面积（平方米；点状为 0，调用方按「返回即包含」处理）。 */
  readonly overlapArea: number;
  /** 相交多边形的几何（GeoJSON 文本，EPSG:4490）。 */
  readonly intersection: string;
}

/** 一次查询的结果：要么拿到全部相交要素，要么拿到查不成的原因词。 */
export type StreetBoundaryOutcome =
  | { readonly ok: true; readonly features: readonly StreetFeature[] }
  | { readonly ok: false; readonly reason: string };

/** 街道镇边界查询端口。 */
export interface StreetBoundaryPort {
  query(request: StreetBoundaryRequest): Promise<StreetBoundaryOutcome>;
}

/** 默认实现所需的参数。 */
export interface StreetBoundaryPortOptions {
  /** 街道镇边界服务地址。未给或空串即视为未配置。 */
  readonly serviceUrl: string | undefined;
  /** 查询超时（毫秒），默认 15000。 */
  readonly timeoutMs?: number;
  /** 取网络，用于测试注入。 */
  readonly fetchImpl?: typeof fetch;
}

/** 查不成的原因词（连字符小写，与核查图层服务同词表）。 */
export const STREET_UNAVAILABLE_REASONS = {
  notConfigured: 'service-not-configured',
  unavailable: 'service-unavailable',
  timeout: 'timeout',
  invalidResponse: 'invalid-response',
} as const;

const DEFAULT_TIMEOUT_MS = 15_000;

interface RawFeature {
  readonly id?: unknown;
  readonly geometry?: unknown;
  readonly properties?: Record<string, unknown>;
}

/** 从图层服务的响应里取一个要素的事实。取不出即 null（返回不合规）。 */
function featureOf(raw: unknown): Omit<StreetFeature, 'partId' | 'partIndex'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const feature = raw as RawFeature;
  const properties = feature.properties ?? {};
  const streetCode =
    typeof feature.id === 'string' && feature.id !== ''
      ? feature.id
      : typeof properties['id'] === 'string' && properties['id'] !== ''
        ? (properties['id'] as string)
        : null;
  const intersection = properties['intersection'];
  const overlapArea = properties['overlap_area'];
  if (
    streetCode === null ||
    typeof intersection !== 'object' ||
    intersection === null ||
    typeof overlapArea !== 'number' ||
    !Number.isFinite(overlapArea)
  ) {
    return null;
  }
  return { streetCode, overlapArea, intersection: JSON.stringify(intersection) };
}

/** 按服务地址建立街道镇边界查询端口。 */
export function createStreetBoundaryPort(options: StreetBoundaryPortOptions): StreetBoundaryPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async query(request: StreetBoundaryRequest): Promise<StreetBoundaryOutcome> {
      const serviceUrl = options.serviceUrl?.trim() ?? '';
      if (serviceUrl === '') {
        return { ok: false, reason: STREET_UNAVAILABLE_REASONS.notConfigured };
      }
      const features: StreetFeature[] = [];
      // 逐面查询：面状街道明细按部件归组，需要每个面对各街道的相交面积。
      for (const part of request.parts) {
        const url = new URL(serviceUrl);
        url.searchParams.set('layer', 'street-boundary');
        url.searchParams.set('geometry', part.geojson);
        url.searchParams.set('srid', '4490');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let body: unknown;
        try {
          const response = await fetchImpl(url.toString(), {
            signal: controller.signal,
            headers: { accept: 'application/geo+json, application/json' },
          });
          if (!response.ok) return { ok: false, reason: STREET_UNAVAILABLE_REASONS.unavailable };
          body = await response.json().catch(() => null);
        } catch (error) {
          const name = error instanceof Error ? error.name : '';
          if (name === 'AbortError' || name === 'TimeoutError') {
            return { ok: false, reason: STREET_UNAVAILABLE_REASONS.timeout };
          }
          return { ok: false, reason: STREET_UNAVAILABLE_REASONS.unavailable };
        } finally {
          clearTimeout(timer);
        }
        if (typeof body !== 'object' || body === null) {
          return { ok: false, reason: STREET_UNAVAILABLE_REASONS.invalidResponse };
        }
        const rawFeatures = (body as { features?: unknown }).features;
        if (!Array.isArray(rawFeatures)) {
          return { ok: false, reason: STREET_UNAVAILABLE_REASONS.invalidResponse };
        }
        for (const raw of rawFeatures) {
          const feature = featureOf(raw);
          if (feature === null) return { ok: false, reason: STREET_UNAVAILABLE_REASONS.invalidResponse };
          features.push({ ...feature, partId: part.partId, partIndex: part.partIndex });
        }
      }
      return { ok: true, features };
    },
  };
}
