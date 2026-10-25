// 核查执行端口的默认实现：按空间服务地址远程实时查询图层（#213，ADR 0021）。
//
// 本地不落图层副本，也不在本地做空间套合：套合与面积由图层服务算好后回给本系统，
// 本实现只负责发起查询、校验返回是否合规、把事实整成端口约定的形状。
//
// 服务契约（本期按此实现；服务地址尚未就绪，契约须与服务提供方对齐后复核）：
//   GET {服务地址}?layer={图层键}&geometry={线索几何的 GeoJSON}&srid=4490
//   200，响应体为 GeoJSON FeatureCollection，每个要素含：
//     id 或 properties.id          要素标识（必填）
//     geometry                     相交要素本身的几何（必填）
//     properties.intersection      相交多边形的 GeoJSON（必填）
//     properties.total_area        该要素图斑总面积，平方米（必填）
//     properties.overlap_area      与线索图斑的相交面积，平方米（必填）
//   缺任一必填项即视为返回不合规。
//
// 服务地址是运行参数（ADR 0008 轨道），不含密钥；服务如需令牌，令牌同样由部署环境注入。

import { VERIFICATION_LAYERS } from './layers.ts';
import type {
  ClueVerificationPort,
  VerificationFeature,
  VerificationLayerResult,
  VerificationOutcome,
  VerificationRequest,
} from './port.ts';

/** 默认实现所需的参数。 */
export interface LayerServiceVerificationOptions {
  /** 图层键 → 服务地址。未给或空串即视为未配置。 */
  readonly serviceUrls: Readonly<Record<string, string | undefined>>;
  /** 查询超时（毫秒），默认 15000。 */
  readonly timeoutMs?: number;
  /** 取时刻，用于写查询时间。 */
  readonly now?: () => Date;
  /** 取网络，用于测试注入。 */
  readonly fetchImpl?: typeof fetch;
}

/** 查不成的原因词（连字符小写）。 */
export const UNAVAILABLE_REASONS = {
  notConfigured: 'service-not-configured',
  unavailable: 'service-unavailable',
  timeout: 'timeout',
  invalidResponse: 'invalid-response',
} as const;

const DEFAULT_TIMEOUT_MS = 15_000;

/** 从图层服务的响应里取一个要素的事实。取不出即 null（返回不合规）。 */
function featureOf(raw: unknown): VerificationFeature | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const feature = raw as {
    id?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown>;
  };
  const properties = feature.properties ?? {};
  const featureId =
    typeof feature.id === 'string' && feature.id !== ''
      ? feature.id
      : typeof properties['id'] === 'string' && properties['id'] !== ''
        ? (properties['id'] as string)
        : null;
  const geometry = feature.geometry;
  const intersection = properties['intersection'];
  const featureArea = properties['total_area'];
  const overlapArea = properties['overlap_area'];
  if (
    featureId === null ||
    typeof geometry !== 'object' ||
    geometry === null ||
    typeof intersection !== 'object' ||
    intersection === null ||
    typeof featureArea !== 'number' ||
    !Number.isFinite(featureArea) ||
    typeof overlapArea !== 'number' ||
    !Number.isFinite(overlapArea)
  ) {
    return null;
  }
  return {
    featureId,
    geometry: JSON.stringify(geometry),
    intersection: JSON.stringify(intersection),
    featureArea,
    overlapArea,
  };
}

/** 一次查询的结果：要么拿到要素，要么拿到查不成的原因词。 */
type QueryOutcome =
  | { readonly ok: true; readonly features: readonly VerificationFeature[] }
  | { readonly ok: false; readonly reason: string };

/** 向一个图层服务发起查询。 */
async function queryLayer(
  serviceUrl: string,
  layerKey: string,
  request: VerificationRequest,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<QueryOutcome> {
  const geometry = request.parts
    .map((part) => part.geojson)
    .join(',');
  const url = new URL(serviceUrl);
  url.searchParams.set('layer', layerKey);
  url.searchParams.set('geometry', geometry);
  url.searchParams.set('srid', '4490');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/geo+json, application/json' },
    });
    if (!response.ok) return { ok: false, reason: UNAVAILABLE_REASONS.unavailable };
    const body = (await response.json().catch(() => null)) as unknown;
    if (typeof body !== 'object' || body === null) {
      return { ok: false, reason: UNAVAILABLE_REASONS.invalidResponse };
    }
    const features = (body as { features?: unknown }).features;
    if (!Array.isArray(features)) return { ok: false, reason: UNAVAILABLE_REASONS.invalidResponse };
    const parsed: VerificationFeature[] = [];
    for (const raw of features) {
      const feature = featureOf(raw);
      if (feature === null) return { ok: false, reason: UNAVAILABLE_REASONS.invalidResponse };
      parsed.push(feature);
    }
    return { ok: true, features: parsed };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      return { ok: false, reason: UNAVAILABLE_REASONS.timeout };
    }
    return { ok: false, reason: UNAVAILABLE_REASONS.unavailable };
  } finally {
    clearTimeout(timer);
  }
}

/** 按服务地址建立核查执行端口。 */
export function createLayerServiceVerificationPort(
  options: LayerServiceVerificationOptions,
): ClueVerificationPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async run(request: VerificationRequest): Promise<VerificationOutcome> {
      const layers: VerificationLayerResult[] = [];
      for (const layer of VERIFICATION_LAYERS) {
        const serviceUrl = options.serviceUrls[layer.key]?.trim() ?? '';
        if (serviceUrl === '') {
          layers.push({
            layerKey: layer.key,
            layerName: layer.name,
            state: 'unavailable',
            serviceUrl: null,
            queriedAt: null,
            unavailableReason: UNAVAILABLE_REASONS.notConfigured,
            features: [],
          });
          continue;
        }
        const outcome = await queryLayer(
          serviceUrl,
          layer.key,
          request,
          timeoutMs,
          fetchImpl,
        );
        if (!outcome.ok) {
          layers.push({
            layerKey: layer.key,
            layerName: layer.name,
            state: 'unavailable',
            serviceUrl,
            queriedAt: now().toISOString(),
            unavailableReason: outcome.reason,
            features: [],
          });
          continue;
        }
        const overlapArea = outcome.features.reduce((sum, feature) => sum + feature.overlapArea, 0);
        layers.push({
          layerKey: layer.key,
          layerName: layer.name,
          state: overlapArea > 0 ? 'overlapped' : 'no_overlap',
          serviceUrl,
          queriedAt: now().toISOString(),
          unavailableReason: null,
          features: outcome.features,
        });
      }
      return { layers };
    },
  };
}
