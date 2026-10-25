// #212 疑似重复领域规则单元用例。
// 只测纯规则：逐面比例与命中判定、比对状态范围、对方状态条、按对方线索分组、
// 决定步数据契约（已知晓／举报必派）、匿名对称脱敏口径、亩换算。
import { describe, expect, it } from 'vitest';

import {
  CLUE_STATUS_LABELS,
  COMPLAINT_SOURCE_GROUP_CODE,
  DUPLICATE_OVERLAP_THRESHOLD,
  MARKABLE_PEER_STATUSES,
  NOT_COMPARABLE_CLUE_STATUSES,
  POINT_NO_OVERLAP_NOTICE,
  RULE_ACK_REQUIRED,
  RULE_COMPLAINT_MUST_DISPATCH,
  duplicateDecisionContract,
  facePairBoldSide,
  facePairRatios,
  formatFacePairLabel,
  formatRatio,
  formatRegisteredAtDay,
  formatRegisteredAtMonth,
  groupFacesByOtherClue,
  isComparableClueStatus,
  isFacePairHit,
  isMarkablePeerStatus,
  limitedLocation,
  maskReporterContact,
  maskReporterName,
  peerStatusAfterHit,
  squareMetersToMu,
  type FacePair,
} from '../src/clue/duplicate/index.ts';

describe('逐面比例与命中判定', () => {
  it('比例＝交集 ÷ 各自单面面积；面积为 0 时记 0', () => {
    expect(facePairRatios({ selfArea: 4, otherArea: 8, intersectionArea: 2 })).toEqual({
      selfRatio: 0.5,
      otherRatio: 0.25,
    });
    expect(facePairRatios({ selfArea: 0, otherArea: 8, intersectionArea: 0 })).toEqual({
      selfRatio: 0,
      otherRatio: 0,
    });
  });

  it('任一方达到阈值即命中；双方皆不达标不命中', () => {
    expect(DUPLICATE_OVERLAP_THRESHOLD).toBe(0.6);
    expect(isFacePairHit({ selfRatio: 0.59, otherRatio: 0.61 })).toBe(true);
    expect(isFacePairHit({ selfRatio: 0.6, otherRatio: 0.1 })).toBe(true);
    expect(isFacePairHit({ selfRatio: 0.5, otherRatio: 0.5999 })).toBe(false);
  });

  it('达标方决定加粗侧；双方都达标记 both', () => {
    expect(facePairBoldSide({ selfRatio: 0.6, otherRatio: 0.3 })).toBe('self');
    expect(facePairBoldSide({ selfRatio: 0.3, otherRatio: 0.6 })).toBe('other');
    expect(facePairBoldSide({ selfRatio: 0.6, otherRatio: 0.6 })).toBe('both');
  });

  it('界面口径：1 位小数，占本线索／占对方', () => {
    expect(formatRatio(2 / 3)).toBe('66.7%');
    expect(formatFacePairLabel({ selfRatio: 0.5, otherRatio: 1 })).toBe('占本线索 50.0%／占对方 100.0%');
  });

  it('亩换算：1 亩 = 2000/3 平方米', () => {
    expect(squareMetersToMu(2000 / 3)).toBeCloseTo(1, 10);
    expect(squareMetersToMu(1000)).toBeCloseTo(1.5, 10);
  });
});

describe('比对范围与对方状态', () => {
  it('结案与已移送退出比对；已立案与其余状态参与', () => {
    expect(NOT_COMPARABLE_CLUE_STATUSES).toEqual(['closed', 'transferred_out']);
    expect(isComparableClueStatus('closed')).toBe(false);
    expect(isComparableClueStatus('transferred_out')).toBe(false);
    expect(isComparableClueStatus('filed')).toBe(true);
    expect(isComparableClueStatus('in_pool')).toBe(true);
    expect(isComparableClueStatus('pending_decision')).toBe(true);
    expect(isComparableClueStatus('held')).toBe(true);
  });

  it('可打标记的对方状态表覆盖六个未结案状态', () => {
    expect([...MARKABLE_PEER_STATUSES]).toEqual([
      'in_pool',
      'pending_decision',
      'org_assigned',
      'handler_assigned',
      'held',
      'filed',
    ]);
    for (const status of MARKABLE_PEER_STATUSES) {
      expect(isMarkablePeerStatus(status)).toBe(true);
      expect(isComparableClueStatus(status)).toBe(true);
    }
    expect(isMarkablePeerStatus('closed')).toBe(false);
    expect(isMarkablePeerStatus('transferred_out')).toBe(false);
  });

  it('对方被撞后状态恒等返回：只打标记，不改状态', () => {
    for (const status of MARKABLE_PEER_STATUSES) {
      expect(peerStatusAfterHit(status)).toBe(status);
    }
    expect(peerStatusAfterHit('pending_decision')).toBe('pending_decision');
  });

  it('状态中文说明覆盖八个主状态', () => {
    for (const status of [
      'pending_decision',
      'in_pool',
      'org_assigned',
      'handler_assigned',
      'held',
      'transferred_out',
      'closed',
      'filed',
    ]) {
      expect(CLUE_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('点状线索的说明文案固定', () => {
    expect(POINT_NO_OVERLAP_NOTICE).toContain('不做空间重合判定');
  });
});

function face(overrides: Partial<FacePair> = {}): FacePair {
  return {
    partId: 'p1',
    partIndex: 0,
    otherClueId: 'c2',
    otherClueCode: 'CL0000000002',
    otherPartId: 'q1',
    otherPartIndex: 0,
    selfRatio: 0.7,
    otherRatio: 0.8,
    intersectionArea: 1200,
    ...overrides,
  };
}

describe('按对方线索分组', () => {
  it('组间按对方编号排，组内按本线索面序号排', () => {
    const faces: FacePair[] = [
      face({ partId: 'p2', partIndex: 1, otherClueId: 'c2', otherClueCode: 'CL0000000002' }),
      face({ partId: 'p1', partIndex: 0, otherClueId: 'c2', otherClueCode: 'CL0000000002' }),
      face({
        partId: 'p3',
        partIndex: 2,
        otherClueId: 'c9',
        otherClueCode: 'CL0000000009',
        otherPartId: 'q2',
        otherPartIndex: 1,
      }),
    ];
    const groups = groupFacesByOtherClue(faces);
    expect(groups.map((group) => group.otherClueCode)).toEqual(['CL0000000002', 'CL0000000009']);
    expect(groups[0]?.faces.map((item) => item.partIndex)).toEqual([0, 1]);
    expect(groups[1]?.faces).toHaveLength(1);
  });

  it('空命中集分组为空', () => {
    expect(groupFacesByOtherClue([])).toEqual([]);
  });
});

describe('决定步数据契约（已知晓／举报必派）', () => {
  it('来源大类 3（群众举报）只能派，不能选不派', () => {
    expect(COMPLAINT_SOURCE_GROUP_CODE).toBe('3');
    const contract = duplicateDecisionContract({
      sourceGroupCode: '3',
      hits: [{ otherClueCode: 'CL0000000001', otherStatus: 'in_pool' }],
    });
    expect(contract).toEqual({
      requiresDecision: true,
      mustDispatch: true,
      allowHold: false,
      defaultHold: false,
      requireAcknowledge: true,
      ruleCodes: [RULE_COMPLAINT_MUST_DISPATCH],
    });
  });

  it('举报类无命中：不经决定步，直接进待分派池', () => {
    const contract = duplicateDecisionContract({ sourceGroupCode: '3', hits: [] });
    expect(contract.requiresDecision).toBe(false);
    expect(contract.mustDispatch).toBe(true);
    expect(contract.ruleCodes).toEqual([RULE_COMPLAINT_MUST_DISPATCH]);
  });

  it('非举报类有命中：默认不派，可点已知晓后派出；命中含未结案须先已知晓', () => {
    const contract = duplicateDecisionContract({
      sourceGroupCode: '16',
      hits: [{ otherClueCode: 'CL0000000001', otherStatus: 'in_pool' }],
    });
    expect(contract.mustDispatch).toBe(false);
    expect(contract.allowHold).toBe(true);
    expect(contract.defaultHold).toBe(true);
    expect(contract.requireAcknowledge).toBe(true);
    expect(contract.ruleCodes).toEqual([]);
  });

  it('全部对方已结案：不须已知晓，仍由人完成决定', () => {
    const contract = duplicateDecisionContract({
      sourceGroupCode: '16',
      hits: [{ otherClueCode: 'CL0000000001', otherStatus: 'closed' }],
    });
    expect(contract.requireAcknowledge).toBe(false);
    expect(contract.requiresDecision).toBe(true);
  });

  it('规则码常量：ack-required 与 complaint-must-dispatch', () => {
    expect(RULE_ACK_REQUIRED).toBe('ack-required');
    expect(RULE_COMPLAINT_MUST_DISPATCH).toBe('complaint-must-dispatch');
  });
});

describe('匿名对称脱敏口径', () => {
  it('登记时间：只到月／完整到日', () => {
    const at = new Date(Date.UTC(2026, 9, 25, 3, 4, 5));
    expect(formatRegisteredAtMonth(at)).toBe('2026-10');
    expect(formatRegisteredAtDay(at)).toBe('2026-10-25');
  });

  it('位置只到区：取到第一个区县级字样；取不到不给位置', () => {
    expect(limitedLocation('广州市天河区石牌街道某地块')).toBe('广州市天河区');
    expect(limitedLocation('  白云区人和镇 ')).toBe('白云区');
    expect(limitedLocation('某地块')).toBeNull();
    expect(limitedLocation(null)).toBeNull();
  });

  it('反映人姓名脱敏：留首字', () => {
    expect(maskReporterName('张三')).toBe('张*');
    expect(maskReporterName('  李四  ')).toBe('李*');
    expect(maskReporterName('')).toBeNull();
    expect(maskReporterName(null)).toBeNull();
  });

  it('反映人联系方式脱敏：保留前三后四，不足 seven 位全遮', () => {
    expect(maskReporterContact('13812345678')).toBe('138****5678');
    expect(maskReporterContact('020-1234567')).toBe('020****4567');
    expect(maskReporterContact('12345')).toBe('*******');
    expect(maskReporterContact(null)).toBeNull();
  });
});
