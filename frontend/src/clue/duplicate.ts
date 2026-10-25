// 疑似重复比对抽屉页签的数据层与纯函数（#212；规格 B「几何与疑似重复」）。
//
// 页签显示：决定步提示（默认不派／已知晓／举报必派）、按对方线索分组的命中面对
// （占本线索／占对方，1 位小数，达标一方加粗）、交集面积（界面按亩换算）、
// 图斑对比、点状线索的「不做空间重合判定」说明、反映人默认脱敏与查看实名入口。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';

/** 重合阈值（规格口径；改配归管理台二期）。任一方 ≥60% 即该面对命中。 */
export const DUPLICATE_HIT_THRESHOLD = 0.6;

/** 1 亩等于的平方米数（界面按亩换算交集面积）。 */
export const SQUARE_METERS_PER_MU = 2000 / 3;

/** 一个命中面对。 */
export interface DuplicateFaceView {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherPartId: string;
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
  readonly selfGeojson: string | null;
  readonly otherGeojson: string | null;
}

/** 一个对方线索分组。 */
export interface DuplicateGroupView {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
  readonly otherStatusLabel: string;
  /** 本组任一方涉匿名（对称脱敏已按此生效，图斑对比关闭）。 */
  readonly anonymous: boolean;
  readonly otherRegisteredAt: string;
  readonly otherLocation: string | null;
  readonly otherReporterName: string | null;
  readonly otherReporterContact: string | null;
  readonly faces: readonly DuplicateFaceView[];
}

/** 决定步数据契约（#214 接线用）。 */
export interface DuplicateDecisionView {
  readonly requiresDecision: boolean;
  readonly mustDispatch: boolean;
  readonly allowHold: boolean;
  readonly defaultHold: boolean;
  readonly requireAcknowledge: boolean;
  readonly ruleCodes: readonly string[];
}

/** 疑似重复比对视图。 */
export interface DuplicateView {
  readonly result: string;
  readonly clueId: string;
  readonly code: string;
  readonly spatialKind: 'face' | 'point';
  readonly pointNotice: string | null;
  readonly status: string;
  readonly statusLabel: string;
  readonly dupComputedAt: string | null;
  readonly decision: DuplicateDecisionView;
  readonly groups: readonly DuplicateGroupView[];
}

/** 取疑似重复比对视图。 */
export async function loadDuplicate(dispatch: ApiDispatch, clueId: string): Promise<DuplicateView> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/duplicates`);
  if (!response.ok) throw data({ status: response.status }, response.status);
  return (await response.json()) as DuplicateView;
}

/** 查看实名（reporter-read 是明文唯一出口，服务端记查阅留痕）。 */
export type ReporterReadResult =
  | {
      readonly ok: true;
      readonly reporterName: string | null;
      readonly reporterContact: string | null;
    }
  | { readonly ok: false; readonly status: number; readonly reason: string | null };

export async function readReporter(dispatch: ApiDispatch, clueId: string): Promise<ReporterReadResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/reporter-read`, { method: 'POST' });
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) {
    const parsed = body as { reporterName?: string | null; reporterContact?: string | null };
    return {
      ok: true,
      reporterName: typeof parsed.reporterName === 'string' ? parsed.reporterName : null,
      reporterContact: typeof parsed.reporterContact === 'string' ? parsed.reporterContact : null,
    };
  }
  const reason =
    typeof body === 'object' && body !== null && typeof (body as { reason?: unknown }).reason === 'string'
      ? (body as { reason: string }).reason
      : null;
  return { ok: false, status: response.status, reason };
}

/** 比例文本（百分比，1 位小数）。 */
export function ratioText(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 交集面积文本（界面按亩换算，1 位小数）。 */
export function areaMuText(squareMeters: number): string {
  return `${(squareMeters / SQUARE_METERS_PER_MU).toFixed(1)} 亩`;
}

/** 达标方：界面上哪一侧加粗。 */
export type HitSide = 'self' | 'other' | 'both' | 'none';

export function hitSide(selfRatio: number, otherRatio: number): HitSide {
  const selfHit = selfRatio >= DUPLICATE_HIT_THRESHOLD;
  const otherHit = otherRatio >= DUPLICATE_HIT_THRESHOLD;
  if (selfHit && otherHit) return 'both';
  if (selfHit) return 'self';
  if (otherHit) return 'other';
  return 'none';
}

/** 决定步提示文案；无须提示即 null。 */
export function decisionText(view: DuplicateView): string | null {
  const decision = view.decision;
  if (decision.mustDispatch && decision.requiresDecision) {
    return '来源为群众举报：只能派，不能选不派；重合信息仍展示供研判。';
  }
  if (!decision.requiresDecision) return null;
  if (decision.requireAcknowledge) {
    return '默认不派；点「已知晓」后可继续派。';
  }
  return '默认不派；全部对方已结案时可直接派。';
}

/** 图斑对比的 SVG 模型。 */
export interface CompareSvgModel {
  readonly viewBox: string;
  /** 本线索面的路径（polygon points）。 */
  readonly selfPoints: string;
  /** 对方面的路径（polygon points）。 */
  readonly otherPoints: string;
}

interface RingPoint {
  readonly x: number;
  readonly y: number;
}

function ringOf(geojson: string): RingPoint[] | null {
  try {
    const parsed = JSON.parse(geojson) as { type?: unknown; coordinates?: unknown };
    if (parsed.type !== 'Polygon' || !Array.isArray(parsed.coordinates)) return null;
    const ring = (parsed.coordinates as unknown[])[0];
    if (!Array.isArray(ring)) return null;
    const points: RingPoint[] = [];
    for (const item of ring) {
      if (!Array.isArray(item) || typeof item[0] !== 'number' || typeof item[1] !== 'number') {
        return null;
      }
      points.push({ x: item[0], y: item[1] });
    }
    return points.length >= 4 ? points : null;
  } catch {
    return null;
  }
}

/** 两面几何 → 对比 SVG 模型；任一面解析不出即 null。 */
export function compareSvgModel(selfGeojson: string, otherGeojson: string): CompareSvgModel | null {
  const self = ringOf(selfGeojson);
  const other = ringOf(otherGeojson);
  if (self === null || other === null) return null;
  const all = [...self, ...other];
  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX <= 0 || spanY <= 0) return null;
  const padX = spanX * 0.08;
  const padY = spanY * 0.08;
  const width = 320;
  const height = 200;
  const project = (point: RingPoint): string => {
    const x = ((point.x - minX + padX) / (spanX + padX * 2)) * width;
    const y = ((maxY - point.y + padY) / (spanY + padY * 2)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  return {
    viewBox: `0 0 ${width} ${height}`,
    selfPoints: self.map(project).join(' '),
    otherPoints: other.map(project).join(' '),
  };
}
