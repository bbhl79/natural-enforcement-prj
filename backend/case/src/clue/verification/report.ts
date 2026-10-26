// 核查报告与分析图的组装（#213；规格 C 节「产物」）。
//
// 产物两件：结构化 JSON 核查报告、EPSG:4490 GeoJSON 分析图。
// 报告完整保存事实，界面可分页但存储不得截断。
// 分析图含全部线索面部件、相交要素与相交多边形。
//
// 本文件是纯函数：入参是核查事实，出参是报告与分析图文本。

import { createHash } from 'node:crypto';

import type { VerificationLayerResult, VerificationPart } from './port.ts';
import { layerStateOf, type LayerState } from './status.ts';

/** 报告版本号（结构变了才改）。 */
export const VERIFICATION_REPORT_VERSION = '1';

/** 组装报告的入参。 */
export interface VerificationReportInput {
  readonly clueId: string;
  readonly clueCode: string;
  readonly domain: string;
  readonly runId: string;
  readonly runNo: number;
  readonly trigger: 'auto' | 'manual';
  /** 运行开始时间（ISO）。 */
  readonly startedAt: string;
  /** 空间对象版本。 */
  readonly spatialVersion: string;
  /** 图斑总面积（平方米）。 */
  readonly totalArea: number;
  readonly parts: readonly VerificationPart[];
  readonly layers: readonly VerificationLayerResult[];
}

/** 报告里一层的全部事实。 */
export interface VerificationReportLayer {
  readonly layerKey: string;
  readonly layerName: string;
  readonly state: LayerState;
  /** 该层的服务地址（不含任何密钥）。 */
  readonly serviceUrl: string | null;
  /** 查询时间（ISO）。 */
  readonly queriedAt: string | null;
  /** 查不成的原因词；不查不成即 null。 */
  readonly unavailableReason: string | null;
  /** 图斑总面积（平方米）。 */
  readonly totalArea: number;
  /** 相交面积（平方米）。 */
  readonly overlapArea: number;
  /** 界外面积（平方米）。 */
  readonly outsideArea: number;
  /** 相交比例（0..1）。 */
  readonly overlapRatio: number;
  /** 全部相交要素。 */
  readonly features: readonly {
    readonly featureId: string;
    readonly featureArea: number;
    readonly overlapArea: number;
    /** 相交要素本身的几何。 */
    readonly geometry: string;
    /** 相交多边形的几何。 */
    readonly intersection: string;
  }[];
  /** 相交多边形（GeoJSON 文本）。 */
  readonly intersections: readonly string[];
}

/** 核查报告。 */
export interface VerificationReport {
  readonly reportVersion: string;
  readonly clueId: string;
  readonly clueCode: string;
  readonly domain: string;
  readonly runId: string;
  readonly runNo: number;
  readonly trigger: 'auto' | 'manual';
  readonly startedAt: string;
  readonly spatialVersion: string;
  /** 图斑总面积（平方米）。 */
  readonly totalArea: number;
  readonly layers: readonly VerificationReportLayer[];
}

/** 一层的派生事实。 */
export function reportLayerOf(
  layer: VerificationLayerResult,
  totalArea: number,
): VerificationReportLayer {
  const overlapArea = layer.features.reduce((sum, feature) => sum + feature.overlapArea, 0);
  const outsideArea = totalArea - overlapArea;
  return {
    layerKey: layer.layerKey,
    layerName: layer.layerName,
    state: layer.state === 'unavailable' ? 'unavailable' : layerStateOf(overlapArea),
    serviceUrl: layer.serviceUrl,
    queriedAt: layer.queriedAt,
    unavailableReason: layer.unavailableReason,
    totalArea,
    overlapArea,
    outsideArea,
    overlapRatio: totalArea > 0 ? overlapArea / totalArea : 0,
    features: layer.features.map((feature) => ({
      featureId: feature.featureId,
      featureArea: feature.featureArea,
      overlapArea: feature.overlapArea,
      geometry: feature.geometry,
      intersection: feature.intersection,
    })),
    intersections: layer.features.map((feature) => feature.intersection),
  };
}

/** 组装结构化 JSON 核查报告。 */
export function buildVerificationReport(input: VerificationReportInput): VerificationReport {
  return {
    reportVersion: VERIFICATION_REPORT_VERSION,
    clueId: input.clueId,
    clueCode: input.clueCode,
    domain: input.domain,
    runId: input.runId,
    runNo: input.runNo,
    trigger: input.trigger,
    startedAt: input.startedAt,
    spatialVersion: input.spatialVersion,
    totalArea: input.totalArea,
    layers: input.layers.map((layer) => reportLayerOf(layer, input.totalArea)),
  };
}

/** 报告的文本形式（存进对象存储的就是它）。 */
export function verificationReportText(report: VerificationReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * 空间对象版本：分析时刻空间对象几何的内容摘要。
 * 内容寻址版本号——几何一改，版本即变，报告与分析图据此能对回当时的几何。
 */
export function spatialVersionOf(parts: readonly VerificationPart[]): string {
  const payload = [...parts]
    .sort((left, right) => left.partIndex - right.partIndex)
    .map((part) => `${part.partIndex}:${part.geojson}`)
    .join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

/** 分析图里的一个要素。 */
interface AnalysisFeature {
  readonly type: 'Feature';
  readonly geometry: unknown;
  readonly properties: Record<string, unknown>;
}

/**
 * 组装分析图（EPSG:4490 GeoJSON）。
 * 含三样东西：全部线索面部件、全部相交要素、全部相交多边形。
 */
export function buildVerificationAnalysis(input: VerificationReportInput): string {
  const features: AnalysisFeature[] = [];
  for (const part of [...input.parts].sort((left, right) => left.partIndex - right.partIndex)) {
    features.push({
      type: 'Feature',
      geometry: JSON.parse(part.geojson) as unknown,
      properties: { kind: 'clue-part', partIndex: part.partIndex, partId: part.partId },
    });
  }
  for (const layer of input.layers) {
    for (const feature of layer.features) {
      features.push({
        type: 'Feature',
        geometry: JSON.parse(feature.geometry) as unknown,
        properties: {
          kind: 'layer-feature',
          layerKey: layer.layerKey,
          layerName: layer.layerName,
          featureId: feature.featureId,
        },
      });
      features.push({
        type: 'Feature',
        geometry: JSON.parse(feature.intersection) as unknown,
        properties: {
          kind: 'intersection',
          layerKey: layer.layerKey,
          layerName: layer.layerName,
          featureId: feature.featureId,
        },
      });
    }
  }
  return JSON.stringify({
    type: 'FeatureCollection',
    name: '内业核查分析图',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4490' } },
    features,
  });
}
