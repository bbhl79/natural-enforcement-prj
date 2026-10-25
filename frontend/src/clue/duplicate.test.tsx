// 疑似重复比对页签的前端测试（#212；规格 B「几何与疑似重复」与交互锁）。
// 测的是可见行为：决定步提示、按对方线索分组、占本线索／占对方（1 位小数、达标加粗）、
// 亩换算、点状说明、匿名脱敏与查看实名入口、图斑对比的匿名关闭。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClueDuplicateTab } from './ClueDuplicateTab';
import {
  areaMuText,
  compareSvgModel,
  decisionText,
  hitSide,
  ratioText,
  type DuplicateFaceView,
  type DuplicateGroupView,
  type DuplicateView,
} from './duplicate';

const FACE: DuplicateFaceView = {
  partId: 'p1',
  partIndex: 0,
  otherPartId: 'q1',
  otherPartIndex: 0,
  selfRatio: 0.5,
  otherRatio: 1,
  intersectionArea: 1200,
  selfGeojson: JSON.stringify({
    type: 'Polygon',
    coordinates: [[[113.1, 23.4], [113.2, 23.4], [113.2, 23.5], [113.1, 23.5], [113.1, 23.4]]],
  }),
  otherGeojson: JSON.stringify({
    type: 'Polygon',
    coordinates: [[[113.1, 23.4], [113.15, 23.4], [113.15, 23.5], [113.1, 23.5], [113.1, 23.4]]],
  }),
};

function group(overrides: Partial<DuplicateGroupView> = {}): DuplicateGroupView {
  return {
    otherClueId: 'c2',
    otherClueCode: 'CL0000000002',
    otherStatus: 'in_pool',
    otherStatusLabel: '待分派',
    anonymous: false,
    otherRegisteredAt: '2026-10-20',
    otherLocation: '广州市天河区石牌街道某地块',
    otherReporterName: '李*',
    otherReporterContact: '137****5678',
    faces: [FACE],
    ...overrides,
  };
}

function view(overrides: Partial<DuplicateView> = {}): DuplicateView {
  return {
    result: 'listed',
    clueId: 'c1',
    code: 'CL0000000001',
    spatialKind: 'face',
    pointNotice: null,
    status: 'pending_decision',
    statusLabel: '待分派决定',
    dupComputedAt: '2026-10-25T01:00:00.000Z',
    decision: {
      requiresDecision: true,
      mustDispatch: false,
      allowHold: true,
      defaultHold: true,
      requireAcknowledge: true,
      ruleCodes: [],
    },
    groups: [group()],
    historicalGroups: [],
    ...overrides,
  };
}

describe('疑似重复比对纯函数', () => {
  it('比例 1 位小数，交集面积按亩换算（1 亩 = 2000/3 平方米）', () => {
    expect(ratioText(2 / 3)).toBe('66.7%');
    expect(areaMuText(2000 / 3)).toBe('1.0 亩');
    expect(areaMuText(1200)).toBe('1.8 亩');
  });

  it('达标方：任一方 ≥60% 即命中侧', () => {
    expect(hitSide(0.5, 1)).toBe('other');
    expect(hitSide(0.6, 0.2)).toBe('self');
    expect(hitSide(0.7, 0.7)).toBe('both');
    expect(hitSide(0.5, 0.5)).toBe('none');
  });

  it('图斑对比模型：两面投影到同一视口', () => {
    const model = compareSvgModel(FACE.selfGeojson ?? '', FACE.otherGeojson ?? '');
    expect(model).not.toBeNull();
    expect(model?.viewBox).toBe('0 0 320 200');
    expect(model?.selfPoints).toContain(',');
    expect(model?.otherPoints).toContain(',');
    expect(compareSvgModel('not-json', FACE.otherGeojson ?? '')).toBeNull();
  });

  it('决定步提示：举报必派与默认不派', () => {
    expect(decisionText(view())).toBe('默认不派；点「已知晓」后可继续派。');
    expect(
      decisionText(
        view({
          decision: {
            requiresDecision: true,
            mustDispatch: true,
            allowHold: false,
            defaultHold: false,
            requireAcknowledge: true,
            ruleCodes: ['complaint-must-dispatch'],
          },
        }),
      ),
    ).toContain('只能派，不能选不派');
    expect(decisionText(view({ decision: { ...view().decision, requiresDecision: false } }))).toBeNull();
  });
});

describe('疑似重复比对页签', () => {
  it('命中面对：占本线索／占对方 1 位小数，达标一方加粗', () => {
    const html = renderToStaticMarkup(
      <ClueDuplicateTab view={view()} onReadReporter={() => Promise.resolve({ ok: false, status: 403, reason: null })} />,
    );
    expect(html).toContain('与 CL0000000002 疑似重复');
    expect(html).toContain('待分派');
    expect(html).toContain('占本线索 50.0%');
    expect(html).toContain('占对方 100.0%');
    expect(html).toContain('dup-hit');
    expect(html).toContain('1.8 亩');
    expect(html).toContain('对比查看');
    expect(html).toContain('查看实名');
  });

  it('决定步提示与命中集计算时间可见', () => {
    const html = renderToStaticMarkup(
      <ClueDuplicateTab view={view()} onReadReporter={() => Promise.resolve({ ok: false, status: 403, reason: null })} />,
    );
    expect(html).toContain('默认不派；点「已知晓」后可继续派。');
    expect(html).toContain('命中集计算于 2026-10-25T01:00:00.000Z');
  });

  it('多面命中按对方线索分组折叠', () => {
    const multi = view({
      groups: [
        group({ faces: [FACE, { ...FACE, partId: 'p2', partIndex: 1, otherPartId: 'q2', otherPartIndex: 1 }] }),
      ],
    });
    const html = renderToStaticMarkup(
      <ClueDuplicateTab view={multi} onReadReporter={() => Promise.resolve({ ok: false, status: 403, reason: null })} />,
    );
    expect(html).toContain('本线索第 1 面 × 对方第 1 面');
    expect(html).toContain('本线索第 2 面 × 对方第 2 面');
    expect(html.match(/dup-group/g)?.length).toBeGreaterThan(0);
  });

  it('点状线索：不做空间重合判定的说明，不显示命中分组', () => {
    const pointView = view({
      spatialKind: 'point',
      pointNotice: '点状线索不做空间重合判定，后续由人工核查判断。',
      groups: [],
      decision: { ...view().decision, requiresDecision: false },
    });
    const html = renderToStaticMarkup(
      <ClueDuplicateTab view={pointView} onReadReporter={() => Promise.resolve({ ok: false, status: 403, reason: null })} />,
    );
    expect(html).toContain('点状线索不做空间重合判定');
    expect(html).not.toContain('占本线索');
  });

  it('涉匿名分组：标记与脱敏展示，反映人默认脱敏', () => {
    const anon = view({
      groups: [group({ anonymous: true, otherRegisteredAt: '2026-10', otherLocation: '广州市天河区' })],
    });
    const html = renderToStaticMarkup(
      <ClueDuplicateTab view={anon} onReadReporter={() => Promise.resolve({ ok: false, status: 403, reason: null })} />,
    );
    expect(html).toContain('涉匿名');
    expect(html).toContain('登记于 2026-10');
    expect(html).toContain('位置：广州市天河区');
    expect(html).toContain('李*');
    expect(html).toContain('137****5678');
  });

  it('举报必派：提示只能派不能选不派', () => {
    const complaint = view({
      decision: {
        requiresDecision: true,
        mustDispatch: true,
        allowHold: false,
        defaultHold: false,
        requireAcknowledge: true,
        ruleCodes: ['complaint-must-dispatch'],
      },
    });
    const html = renderToStaticMarkup(
      <ClueDuplicateTab view={complaint} onReadReporter={() => Promise.resolve({ ok: false, status: 403, reason: null })} />,
    );
    expect(html).toContain('只能派，不能选不派');
  });
});
