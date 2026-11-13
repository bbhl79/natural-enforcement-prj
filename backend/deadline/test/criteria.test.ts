// 用途：反向校验期限规则与 L1 判据底稿一致。判据编号与期望值来自生成的 criteria.generated.ts。
// 调用方：backend/deadline 包的 vitest 用例（pnpm -r test）。
// 边界：只读常量，不连库、不写盘。判据口径变更走 docs/research/criteria/ 底稿与生成器。
// 依据：docs/research/criteria/README.md；docs/roadmap-next.md 的 2.5 与 E8。

import { describe, expect, it } from 'vitest';

import {
  BUSINESS_DECISIONS,
  COMPLEX_CASE_REASON,
  DEADLINE_RULES,
  DEFAULT_EXTENSION_CAP_DAYS,
  LEGAL_CRITERIA,
  checkExtension,
} from '../src/index.ts';

const CRITERIA = new Map(LEGAL_CRITERIA.map((criterion) => [criterion.id, criterion]));
const DECISIONS = new Map(BUSINESS_DECISIONS.map((decision) => [decision.id, decision]));

// 从 basis 里取判据编号。格式见 backend/deadline/src/rules.ts 的 DeadlineRule.basis。
function criterionRefs(basis: string): string[] {
  return [...basis.matchAll(/判据:(CRIT-[A-Z0-9-]+)/gu)].map((match) => match[1]);
}

// 从 basis 里取业务决策编号。
function decisionRefs(basis: string): string[] {
  return [...basis.matchAll(/业务决策:(DEC-[0-9]+)/gu)].map((match) => match[1]);
}

// 反向校验：规则登记表的每条数值都能追溯到底稿判据或业务决策。
describe('期限规则与 L1 判据的反向校验（docs/research/criteria）', () => {
  it('每条规则的 basis 都指向在场判据或业务决策，且期望值一致', () => {
    for (const rule of DEADLINE_RULES) {
      const criterionIds = criterionRefs(rule.basis);
      const decisionIds = decisionRefs(rule.basis);
      expect(criterionIds.length + decisionIds.length, `${rule.key} 的 basis 未指向判据或业务决策`).toBeGreaterThan(0);

      for (const id of criterionIds) {
        const criterion = CRITERIA.get(id);
        expect(criterion, `${rule.key} 引用了不存在的判据 ${id}`).toBeDefined();
        if (!criterion) continue;
        expect(criterion.status, `${id} 不是 active`).toBe('active');
        const ruleKey = criterion.expected?.ruleKey;
        if (typeof ruleKey === 'string') {
          expect(ruleKey, `${id} 的 ruleKey 与 ${rule.key} 不符`).toBe(rule.key);
        }
        const dayCount = criterion.expected?.dayCount;
        if (typeof dayCount === 'number') {
          expect(rule.dayCount, `${rule.key} 的天数与 ${id} 不符`).toBe(dayCount);
        }
        const dayBasis = criterion.expected?.dayBasis;
        if (typeof dayBasis === 'string') {
          expect(rule.dayBasis, `${rule.key} 的口径与 ${id} 不符`).toBe(dayBasis);
        }
      }

      for (const id of decisionIds) {
        const decision = DECISIONS.get(id);
        expect(decision, `${rule.key} 引用了不存在的业务决策 ${id}`).toBeDefined();
        if (decision) {
          expect(decision.consumer, `${id} 的消费方不是 ${rule.key}`).toBe(
            `backend/deadline/src/rules.ts#${rule.key}`,
          );
        }
      }
    }
  });

  it('延长上限与业务决策的消费方都与规则登记表一致', () => {
    const extensionCap = CRITERIA.get('CRIT-DL-002')?.expected?.extensionCapDays;
    expect(typeof extensionCap).toBe('number');
    expect(DEFAULT_EXTENSION_CAP_DAYS).toBe(extensionCap);
    expect(checkExtension(30, '').ok).toBe(true);
    expect(checkExtension(31, '').ok).toBe(false);
    expect(checkExtension(31, COMPLEX_CASE_REASON).ok).toBe(true);

    const ruleKeys = new Set(DEADLINE_RULES.map((rule) => rule.key));
    for (const decision of BUSINESS_DECISIONS) {
      const matched = /^backend\/deadline\/src\/rules\.ts#(.+)$/u.exec(decision.consumer);
      if (matched) expect(ruleKeys.has(matched[1]), `${decision.id} 的消费方规则不在登记表内`).toBe(true);
    }
  });
});