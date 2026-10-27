// #263 机关层利害关系：有一行即已勾选；签出、呈批、迁移都不阻断。
import { describe, expect, it } from 'vitest';

import {
  AGENCY_CONFLICT_GATES,
  AGENCY_CONFLICT_OUTLET,
  AGENCY_CONFLICT_WARNING,
  agencyConflictBlocks,
  agencyConflictMarked,
  agencyConflictNotice,
  type AgencyConflictMark,
} from '../src/agency-conflict/rules.ts';

const mark: AgencyConflictMark = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  caseId: 'case-1',
  orgUnitId: 'org-1',
  markedBy: 'person-1',
  createdAt: new Date('2026-10-27T00:00:00.000Z'),
};

describe('机关层利害关系提示', () => {
  it('没有记录时未勾选，有一行时已勾选并给出提示', () => {
    expect(agencyConflictMarked([])).toBe(false);
    expect(agencyConflictNotice([])).toEqual({ marked: false, warning: null, outlet: null });
    expect(agencyConflictMarked([mark])).toBe(true);
    expect(agencyConflictNotice([mark])).toEqual({
      marked: true,
      warning: AGENCY_CONFLICT_WARNING,
      outlet: AGENCY_CONFLICT_OUTLET,
    });
    expect(AGENCY_CONFLICT_WARNING).toBe('本机关与本案当事人存在利害关系');
    expect(AGENCY_CONFLICT_OUTLET).toBe('线下报请上级处理');
  });

  it('签出、呈批、迁移都不因机关层利害关系阻断', () => {
    for (const gate of AGENCY_CONFLICT_GATES) {
      expect(agencyConflictBlocks(gate)).toBe(false);
    }
  });
});
