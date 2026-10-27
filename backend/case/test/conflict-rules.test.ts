// #237 人员层利害关系：状态集与决定人两级。不碰数据库。
import { describe, expect, it } from 'vitest';

import {
  activeConflicts,
  deciderSeatMatches,
  excludeConflictedCandidates,
  requiredDeciderSeat,
  signingPaused,
  statusAfterDecision,
  type ConflictEventFact,
} from '../src/conflict/index.ts';

function event(partial: Partial<ConflictEventFact> & Pick<ConflictEventFact, 'id' | 'status'>): ConflictEventFact {
  return {
    lineageId: partial.lineageId ?? partial.id,
    caseId: 'case-1',
    personId: 'person-1',
    source: 'self',
    reason: '理由',
    seq: partial.seq ?? 1,
    createdAt: new Date('2026-10-27T00:00:00.000Z'),
    ...partial,
  };
}

describe('活动状态集', () => {
  it('声明与生效计入，驳回不计入', () => {
    const rows = [
      event({ id: 'a', personId: 'p1', status: 'declared' }),
      event({ id: 'b', personId: 'p2', status: 'effective', createdAt: new Date('2026-10-27T00:01:00.000Z') }),
      event({ id: 'c', personId: 'p3', status: 'rejected', createdAt: new Date('2026-10-27T00:02:00.000Z') }),
    ];
    expect(activeConflicts(rows).map((row) => row.personId)).toEqual(['p1', 'p2']);
    expect(signingPaused(rows, 'p1')).toBe(true);
    expect(signingPaused(rows, 'p2')).toBe(true);
    expect(signingPaused(rows, 'p3')).toBe(false);
  });

  it('同一声明链以最新一行为准：驳回后不再活动，回避后仍活动', () => {
    const declared = event({ id: 'a1', status: 'declared', createdAt: new Date('2026-10-27T00:00:00.000Z') });
    const rejected = event({
      id: 'a2',
      lineageId: 'a1',
      status: 'rejected',
      seq: 2,
      createdAt: new Date('2026-10-27T00:00:00.000Z'),
    });
    expect(activeConflicts([declared, rejected], 'person-1')).toEqual([]);
    expect(signingPaused([declared, rejected], 'person-1')).toBe(false);

    const effective = event({
      id: 'b2',
      lineageId: 'b1',
      personId: 'person-2',
      status: 'effective',
      seq: 2,
      createdAt: new Date('2026-10-27T00:00:00.000Z'),
    });
    const opened = event({
      id: 'b1',
      personId: 'person-2',
      status: 'declared',
      createdAt: new Date('2026-10-27T00:01:00.000Z'),
    });
    expect(activeConflicts([opened, effective], 'person-2').map((row) => row.status)).toEqual(['effective']);
    expect(signingPaused([opened, effective], 'person-2')).toBe(true);
  });

  it('法审候选去掉有声明或生效记录的人，并保持其余人的顺序', () => {
    const rows = [
      event({ id: 'a', personId: 'keep-1', status: 'rejected' }),
      event({ id: 'b', personId: 'drop', status: 'declared' }),
    ];
    expect(excludeConflictedCandidates(['drop', 'keep-1', 'keep-2'], rows)).toEqual(['keep-1', 'keep-2']);
  });
});

describe('决定人两级', () => {
  it('本人申请且被申请人不是承办机构负责人，由承办机构负责人决定', () => {
    expect(requiredDeciderSeat({ source: 'self', subjectIsHandlingOrgHead: false })).toBe('handling-org-head');
    expect(deciderSeatMatches({
      source: 'self',
      subjectIsHandlingOrgHead: false,
      deciderIsHandlingOrgHead: true,
      deciderIsCompetentAuthorityHead: false,
    })).toBe(true);
    expect(deciderSeatMatches({
      source: 'self',
      subjectIsHandlingOrgHead: false,
      deciderIsHandlingOrgHead: false,
      deciderIsCompetentAuthorityHead: true,
    })).toBe(false);
  });

  it('当事人申请由主管部门负责人决定，承办机构负责人作出决定不匹配', () => {
    expect(requiredDeciderSeat({ source: 'party', subjectIsHandlingOrgHead: false })).toBe('competent-authority-head');
    expect(deciderSeatMatches({
      source: 'party',
      subjectIsHandlingOrgHead: false,
      deciderIsHandlingOrgHead: true,
      deciderIsCompetentAuthorityHead: false,
    })).toBe(false);
    expect(deciderSeatMatches({
      source: 'party',
      subjectIsHandlingOrgHead: false,
      deciderIsHandlingOrgHead: false,
      deciderIsCompetentAuthorityHead: true,
    })).toBe(true);
  });

  it('被申请人是承办机构负责人时，改由主管部门负责人决定', () => {
    expect(requiredDeciderSeat({ source: 'self', subjectIsHandlingOrgHead: true })).toBe('competent-authority-head');
    expect(deciderSeatMatches({
      source: 'self',
      subjectIsHandlingOrgHead: true,
      deciderIsHandlingOrgHead: true,
      deciderIsCompetentAuthorityHead: false,
    })).toBe(false);
    expect(statusAfterDecision('recuse')).toBe('effective');
    expect(statusAfterDecision('reject')).toBe('rejected');
  });
});
