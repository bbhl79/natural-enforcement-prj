// 内业核查的领域规则单测（#213，unit 层无库、无图层服务）。
//
// 接缝 = 案件聚合模块的公共出口：图层目录、状态口径、核查执行端口、报告与分析图组装。
// 只测外部行为（目录内容、状态判定、报告与分析图的事实），不测内部实现。
import { describe, expect, it } from 'vitest';

import {
  ALL_LAYERS,
  VERIFICATION_LAYERS,
  buildVerificationAnalysis,
  buildVerificationReport,
  createLayerServiceVerificationPort,
  isTerminalClueStatus,
  layerStateOf,
  requiresVerification,
  spatialVersionOf,
} from '../src/index.ts';
import type {
  VerificationLayerResult,
  VerificationOutcome,
  VerificationRequest,
} from '../src/index.ts';

const SQUARE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [113, 23],
      [113.1, 23],
      [113.1, 23.1],
      [113, 23.1],
      [113, 23],
    ],
  ],
});

const REQUEST: VerificationRequest = {
  clueId: 'clue-1',
  domain: 'land',
  spatialVersion: 'v-1',
  totalArea: 1000,
  parts: [{ partId: 'part-1', partIndex: 0, geojson: SQUARE }],
};

function layerOf(overrides: Partial<VerificationLayerResult>): VerificationLayerResult {
  return {
    layerKey: 'permanent-farmland',
    layerName: '永久基本农田',
    state: 'overlapped',
    serviceUrl: 'https://layers.example/permanent-farmland',
    queriedAt: '2026-10-25T01:00:00.000Z',
    unavailableReason: null,
    features: [],
    ...overrides,
  };
}

describe('核查图层目录', () => {
  it('初始八类图层：七类核查图层加街道镇边界', () => {
    expect(VERIFICATION_LAYERS).toHaveLength(7);
    expect(ALL_LAYERS).toHaveLength(8);
    expect(ALL_LAYERS.map((layer) => layer.name)).toContain('街道镇边界');
    expect(ALL_LAYERS.map((layer) => layer.name)).toContain('永久基本农田');
    expect(ALL_LAYERS.map((layer) => layer.name)).toContain('供地红线');
  });

  it('不虚构矿权图层', () => {
    expect(ALL_LAYERS.map((layer) => layer.name).join('、')).not.toContain('矿权');
  });
});

describe('核查状态口径', () => {
  it('只有土地与矿产跑内业核查', () => {
    expect(requiresVerification('land')).toBe(true);
    expect(requiresVerification('mineral')).toBe(true);
    expect(requiresVerification('survey')).toBe(false);
    expect(requiresVerification('planning')).toBe(false);
  });

  it('终态线索不再允许手动重跑', () => {
    expect(isTerminalClueStatus('closed')).toBe(true);
    expect(isTerminalClueStatus('transferred_out')).toBe(true);
    expect(isTerminalClueStatus('in_pool')).toBe(false);
    expect(isTerminalClueStatus('pending_decision')).toBe(false);
  });

  it('三态由相交面积决定：大于零有相交，等于零无相交', () => {
    expect(layerStateOf(1)).toBe('overlapped');
    expect(layerStateOf(0)).toBe('no_overlap');
  });
});

describe('核查报告', () => {
  it('每层给出图斑总面积、相交面积、界外面积与相交比例', () => {
    const report = buildVerificationReport({
      clueId: 'clue-1',
      clueCode: 'CL0000000001',
      domain: 'land',
      runId: 'run-1',
      runNo: 1,
      trigger: 'auto',
      startedAt: '2026-10-25T01:00:00.000Z',
      spatialVersion: 'v-1',
      totalArea: 1000,
      parts: REQUEST.parts,
      layers: [
        layerOf({
          features: [
            {
              featureId: 'f-1',
              geometry: SQUARE,
              intersection: SQUARE,
              featureArea: 400,
              overlapArea: 250,
            },
          ],
        }),
      ],
    });

    const layer = report.layers[0];
    expect(layer?.state).toBe('overlapped');
    expect(layer?.totalArea).toBe(1000);
    expect(layer?.overlapArea).toBe(250);
    expect(layer?.outsideArea).toBe(750);
    expect(layer?.overlapRatio).toBeCloseTo(0.25);
    expect(layer?.serviceUrl).toBe('https://layers.example/permanent-farmland');
    expect(layer?.queriedAt).toBe('2026-10-25T01:00:00.000Z');
    expect(layer?.features).toHaveLength(1);
  });

  it('查不成的层在三态里是 unavailable，报告不冒充成功', () => {
    const report = buildVerificationReport({
      clueId: 'clue-1',
      clueCode: 'CL0000000001',
      domain: 'land',
      runId: 'run-1',
      runNo: 1,
      trigger: 'auto',
      startedAt: '2026-10-25T01:00:00.000Z',
      spatialVersion: 'v-1',
      totalArea: 1000,
      parts: REQUEST.parts,
      layers: [
        layerOf({
          state: 'unavailable',
          serviceUrl: null,
          queriedAt: null,
          unavailableReason: 'service-not-configured',
        }),
      ],
    });

    expect(report.layers[0]?.state).toBe('unavailable');
    expect(report.layers[0]?.unavailableReason).toBe('service-not-configured');
  });

  it('全部相交要素都进报告，不截断', () => {
    const features = Array.from({ length: 5 }, (_, index) => ({
      featureId: `f-${index}`,
      geometry: SQUARE,
      intersection: SQUARE,
      featureArea: 10,
      overlapArea: 5,
    }));
    const report = buildVerificationReport({
      clueId: 'clue-1',
      clueCode: 'CL0000000001',
      domain: 'land',
      runId: 'run-1',
      runNo: 1,
      trigger: 'auto',
      startedAt: '2026-10-25T01:00:00.000Z',
      spatialVersion: 'v-1',
      totalArea: 1000,
      parts: REQUEST.parts,
      layers: [layerOf({ features })],
    });

    expect(report.layers[0]?.features).toHaveLength(5);
    expect(report.layers[0]?.intersections).toHaveLength(5);
    expect(report.layers[0]?.overlapArea).toBe(25);
  });
});

describe('分析图', () => {
  it('含全部线索面部件、相交要素与相交多边形', () => {
    const analysis = JSON.parse(
      buildVerificationAnalysis({
        clueId: 'clue-1',
        clueCode: 'CL0000000001',
        domain: 'land',
        runId: 'run-1',
        runNo: 1,
        trigger: 'auto',
        startedAt: '2026-10-25T01:00:00.000Z',
        spatialVersion: 'v-1',
        totalArea: 1000,
        parts: REQUEST.parts,
        layers: [
          layerOf({
            features: [
              {
                featureId: 'f-1',
                geometry: SQUARE,
                intersection: SQUARE,
                featureArea: 400,
                overlapArea: 250,
              },
            ],
          }),
        ],
      }),
    ) as { type: string; features: { properties: { kind: string } }[] };

    expect(analysis.type).toBe('FeatureCollection');
    const kinds = analysis.features.map((feature) => feature.properties.kind);
    expect(kinds).toContain('clue-part');
    expect(kinds).toContain('layer-feature');
    expect(kinds).toContain('intersection');
    expect(analysis.features).toHaveLength(3);
  });
});

describe('空间对象版本', () => {
  it('几何一改版本即变', () => {
    const before = spatialVersionOf(REQUEST.parts);
    const after = spatialVersionOf([
      { partId: 'part-1', partIndex: 0, geojson: SQUARE.replace('113.1', '113.2') },
    ]);

    expect(before).not.toBe(after);
    expect(spatialVersionOf(REQUEST.parts)).toBe(before);
  });
});

describe('核查执行端口的默认实现（按服务地址远程查询）', () => {
  it('未配置服务地址的层判 unavailable，不冒充查过没有', async () => {
    const port = createLayerServiceVerificationPort({ serviceUrls: {} });

    const outcome = await port.run(REQUEST);

    const first = outcome.layers[0];
    expect(first?.state).toBe('unavailable');
    expect(first?.unavailableReason).toBe('service-not-configured');
    expect(first?.serviceUrl).toBeNull();
  });

  it('服务不可用判 unavailable（service-unavailable）', async () => {
    const port = createLayerServiceVerificationPort({
      serviceUrls: { 'permanent-farmland': 'https://layers.example/permanent-farmland' },
      fetchImpl: async () => {
        throw new Error('连接被拒');
      },
    });

    const outcome = await port.run(REQUEST);

    const layer = outcome.layers.find((item) => item.layerKey === 'permanent-farmland');
    expect(layer?.state).toBe('unavailable');
    expect(layer?.unavailableReason).toBe('service-unavailable');
    expect(layer?.serviceUrl).toBe('https://layers.example/permanent-farmland');
  });

  it('返回不合规判 unavailable（invalid-response）', async () => {
    const port = createLayerServiceVerificationPort({
      serviceUrls: { 'permanent-farmland': 'https://layers.example/permanent-farmland' },
      fetchImpl: async () =>
        new Response(JSON.stringify({ type: 'FeatureCollection' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const outcome = await port.run(REQUEST);

    const layer = outcome.layers.find((item) => item.layerKey === 'permanent-farmland');
    expect(layer?.state).toBe('unavailable');
    expect(layer?.unavailableReason).toBe('invalid-response');
  });

  it('查得相交要素时判 overlapped，并回传要素标识与几何', async () => {
    const port = createLayerServiceVerificationPort({
      serviceUrls: { 'permanent-farmland': 'https://layers.example/permanent-farmland' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                id: 'f-1',
                geometry: JSON.parse(SQUARE),
                properties: {
                  intersection: JSON.parse(SQUARE),
                  total_area: 400,
                  overlap_area: 250,
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const outcome: VerificationOutcome = await port.run(REQUEST);

    const layer = outcome.layers.find((item) => item.layerKey === 'permanent-farmland');
    expect(layer?.state).toBe('overlapped');
    expect(layer?.features[0]?.featureId).toBe('f-1');
    expect(layer?.features[0]?.overlapArea).toBe(250);
  });

  it('查得无相交判 no_overlap', async () => {
    const port = createLayerServiceVerificationPort({
      serviceUrls: { 'permanent-farmland': 'https://layers.example/permanent-farmland' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ type: 'FeatureCollection', features: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const outcome = await port.run(REQUEST);

    const layer = outcome.layers.find((item) => item.layerKey === 'permanent-farmland');
    expect(layer?.state).toBe('no_overlap');
  });
});
