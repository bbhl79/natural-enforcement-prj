// 内业核查页签的前端测试（#213；规格 C 节）。
// 测的是可见行为：三态文案、每层相交事实、没跑成的重跑提示、无权时不显示重跑入口。

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClueVerificationTab } from './ClueVerificationTab';
import {
  areaText,
  layerStateLabel,
  ratioText,
  retryBlockedText,
  type VerificationLayerView,
  type VerificationRunView,
  type VerificationView,
} from './verification';

const LAYER: VerificationLayerView = {
  layerKey: 'permanent-farmland',
  layerName: '永久基本农田',
  state: 'overlapped',
  stateLabel: '有相交',
  totalArea: 1000,
  overlapArea: 250,
  outsideArea: 750,
  overlapRatio: 0.25,
  featureCount: 3,
  serviceUrl: 'https://layers.example/permanent-farmland',
  queriedAt: '2026-10-25T01:00:00.000Z',
  unavailableReason: null,
};

const RUN: VerificationRunView = {
  id: 'run-1',
  runNo: 1,
  status: 'done',
  statusLabel: '已完成',
  trigger: 'auto',
  attemptsUsed: 1,
  failureCategory: null,
  missingLayers: [],
  startedAt: '2026-10-25T01:00:00.000Z',
  endedAt: '2026-10-25T01:00:05.000Z',
  layers: [LAYER],
};

function view(overrides: Partial<VerificationView> = {}): VerificationView {
  return {
    result: 'listed',
    clueId: 'clue-1',
    code: 'CL0000000001',
    domain: 'land',
    required: true,
    verificationStatus: 'done',
    verificationStatusLabel: '已完成',
    clueStatus: 'in_pool',
    canRetry: true,
    retryBlockedReason: null,
    current: RUN,
    runs: [RUN],
    artifacts: {
      report: { fileKey: 'clue/clue-1/verification/run-1/report.json', versionId: 'v1' },
      analysis: { fileKey: 'clue/clue-1/verification/run-1/analysis.geojson', versionId: 'v2' },
    },
    ...overrides,
  };
}

describe('内业核查页签', () => {
  it('已完成：显示三态、每层相交事实与产物下载入口', () => {
    const html = renderToStaticMarkup(<ClueVerificationTab view={view()} />);

    expect(html).toContain('已完成');
    expect(html).toContain('永久基本农田');
    expect(html).toContain('250.0 平方米');
    expect(html).toContain('25.0%');
    expect(html).toContain('下载核查报告');
    expect(html).toContain('下载分析图');
  });

  it('没跑成：提示重跑一直挂着，仍可手动重跑', () => {
    const html = renderToStaticMarkup(
      <ClueVerificationTab
        view={view({
          verificationStatus: 'failed',
          verificationStatusLabel: '没跑成',
          current: {
            ...RUN,
            status: 'failed',
            statusLabel: '没跑成',
            failureCategory: 'deterministic',
            missingLayers: [{ key: 'permanent-farmland', name: '永久基本农田' }],
            layers: [],
          },
          runs: [],
          artifacts: null,
        })}
        onRetry={() => undefined}
      />,
    );

    expect(html).toContain('没跑成');
    expect(html).toContain('重跑提示一直挂到跑成');
    expect(html).toContain('缺图层：永久基本农田');
    expect(html).toContain('手动重跑');
  });

  it('不设内业核查：测绘与规划类线索不跑核查', () => {
    const html = renderToStaticMarkup(
      <ClueVerificationTab
        view={view({ required: false, verificationStatus: 'not_required', verificationStatusLabel: '不设内业核查' })}
      />,
    );

    expect(html).toContain('不设内业核查');
    expect(html).not.toContain('手动重跑');
  });

  it('无权重跑：入口不显示，并说明原因', () => {
    const html = renderToStaticMarkup(
      <ClueVerificationTab view={view({ canRetry: false, retryBlockedReason: 'permission-denied' })} onRetry={() => undefined} />,
    );

    expect(html).not.toContain('手动重跑');
    expect(html).toContain('没有重跑权限');
  });
});

describe('内业核查页签的纯函数', () => {
  it('面积与比例的显示口径', () => {
    expect(areaText(250)).toBe('250.0 平方米');
    expect(ratioText(0.25)).toBe('25.0%');
  });

  it('三态标签', () => {
    expect(layerStateLabel('overlapped')).toBe('有相交');
    expect(layerStateLabel('no_overlap')).toBe('无相交');
    expect(layerStateLabel('unavailable')).toBe('查不成');
  });

  it('不能重跑的原因各有说法', () => {
    expect(retryBlockedText(view())).toBeNull();
    expect(retryBlockedText(view({ canRetry: false, retryBlockedReason: 'clue-terminal' }))).toContain('终态');
    expect(retryBlockedText(view({ canRetry: false, retryBlockedReason: 'verification-not-required' }))).toContain('不设内业核查');
    expect(retryBlockedText(view({ canRetry: false, retryBlockedReason: 'verification-running' }))).toContain('核查正在跑');
  });
});
