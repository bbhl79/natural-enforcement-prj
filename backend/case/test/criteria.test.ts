// 用途：反向校验法制审核与集体讨论清单与 L1 判据底稿一致。
// 调用方：backend/case 包的 vitest 用例（pnpm -r test）。
// 边界：只读常量，不连库、不写盘。清单口径变更走 docs/research/criteria/ 底稿与生成器。
// 依据：docs/research/criteria/README.md；docs/roadmap-next.md 的 2.3 判据资格闸。

import { describe, expect, it } from 'vitest';

import { BUSINESS_DECISIONS, LEGAL_CRITERIA } from '../src/criteria.generated.ts';
import {
  COLLECTIVE_DISCUSSION_CRITERIA,
  MANDATORY_REVIEW_ITEMS,
  MANDATORY_REVIEW_PENALTY_CODES,
} from '../src/legal-review/rules.ts';
import { TRANSFER_CLOCK_BASIS } from '../src/transfer/rules.ts';

const CRITERIA = new Map(LEGAL_CRITERIA.map((criterion) => [criterion.id, criterion]));
const REVIEW_CODES = new Set<string>(MANDATORY_REVIEW_ITEMS.map((item) => item.code));
const COLLECTIVE_CODES = new Set<string>(COLLECTIVE_DISCUSSION_CRITERIA.map((item) => item.code));

// 反向校验：必审清单与集体讨论清单的每一项都能追溯到法规判据或业务决策。
describe('法制审核与集体讨论清单与 L1 判据的反向校验（docs/research/criteria）', () => {
  it('法制审核情形逐项落在必审清单内', () => {
    for (const id of ['CRIT-LR-001', 'CRIT-LR-002']) {
      const grounds = CRITERIA.get(id)?.expected?.grounds;
      expect(grounds, `${id} 缺少 grounds 期望值`).toBeDefined();
      for (const [statuteItem, codes] of Object.entries(grounds as Record<string, string[]>)) {
        for (const code of codes) {
          expect(REVIEW_CODES.has(code), `${id} 的「${statuteItem}」对应代码 ${code} 不在必审清单内`).toBe(true);
        }
      }
    }
  });

  it('集体讨论标准逐项落在清单内', () => {
    let checked = 0;
    for (const criterion of LEGAL_CRITERIA) {
      const code = criterion.expected?.collectiveCode;
      if (typeof code !== 'string') continue;
      checked += 1;
      expect(COLLECTIVE_CODES.has(code), `${criterion.id} 的集体讨论代码 ${code} 不在清单内`).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('涉刑移送不计入期间写明办法第三十八条第二款', () => {
    expect(TRANSFER_CLOCK_BASIS.basisNote).toContain('第38条第2款');
  });

  it('业务决策的消费方符号在场', () => {
    const penaltyCodes = new Set(MANDATORY_REVIEW_PENALTY_CODES.map((row) => row.code));
    expect(penaltyCodes.size).toBeGreaterThan(0);
    const decision = BUSINESS_DECISIONS.find((row) => row.id === 'DEC-003');
    expect(decision?.consumer).toBe('backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_PENALTY_CODES');
    expect(MANDATORY_REVIEW_ITEMS.some((item) => item.code === 'criminal-transfer')).toBe(true);
  });
});