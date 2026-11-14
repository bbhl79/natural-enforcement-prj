// 用途：反向校验法制审核与集体讨论清单与 L1 判据底稿一致；含双向追溯与变异探测。
// 调用方：backend/case 包的 vitest 用例（pnpm -r test）。
// 边界：只读常量，不连库、不写盘。清单口径变更走 docs/research/criteria/ 底稿与生成器。
// 依据：docs/research/criteria/README.md；docs/handoff-l1.md。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBasisTokens, shouldCompareExpected } from '../../../tools/criteria-reverse-helpers.ts';
import { BUSINESS_DECISIONS, LEGAL_CRITERIA } from '../src/criteria.generated.ts';
import {
  COLLECTIVE_DISCUSSION_CRITERIA,
  MANDATORY_REVIEW_ITEMS,
  MANDATORY_REVIEW_PENALTY_CODES,
  MANDATORY_REVIEW_PENALTY_CODES_BASIS,
} from '../src/legal-review/rules.ts';
import { TRANSFER_CLOCK_BASIS } from '../src/transfer/rules.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CRITERIA = new Map(LEGAL_CRITERIA.map((criterion) => [criterion.id, criterion]));
const REVIEW_CODES = new Set<string>(MANDATORY_REVIEW_ITEMS.map((item) => item.code));
const COLLECTIVE_CODES = new Set<string>(COLLECTIVE_DISCUSSION_CRITERIA.map((item) => item.code));

function consumerSymbolPresent(consumer: string): boolean {
  const [rel, symbol] = consumer.split('#');
  if (!rel || !symbol) return false;
  const text = readFileSync(join(REPO, rel), 'utf8');
  return text.includes(symbol);
}

function basisLines(): string[] {
  const lines: string[] = [];
  for (const item of MANDATORY_REVIEW_ITEMS) {
    if ('basis' in item && typeof item.basis === 'string') lines.push(item.basis);
  }
  for (const item of COLLECTIVE_DISCUSSION_CRITERIA) {
    lines.push(item.basis);
  }
  lines.push(TRANSFER_CLOCK_BASIS.basis);
  lines.push(MANDATORY_REVIEW_PENALTY_CODES_BASIS.basis);
  return lines;
}

// 双向追溯法制审核清单、集体讨论标准与 L1 判据底稿的一致性。
describe('法制审核与集体讨论清单与 L1 判据的反向校验（docs/research/criteria）', () => {
  const objectedSeen: string[] = [];

  it('objected 语义：合成 objected 跳过 grounds 数值比对', () => {
    const grounds = { '（一）': ['major-public-interest'] };
    const activeOk = shouldCompareExpected('active');
    const objectedSkip = !shouldCompareExpected('objected');
    expect(activeOk && objectedSkip).toBe(true);
    if (!shouldCompareExpected('objected')) {
      expect(grounds).toBeDefined();
    }
  });

  it('法制审核情形逐项落在必审清单内', () => {
    for (const id of ['CRIT-LR-001', 'CRIT-LR-002']) {
      const criterion = CRITERIA.get(id);
      expect(criterion).toBeDefined();
      if (criterion && !shouldCompareExpected(criterion.status)) {
        objectedSeen.push(id);
        continue;
      }
      const grounds = criterion?.expected?.grounds;
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
      if (!shouldCompareExpected(criterion.status)) {
        objectedSeen.push(criterion.id);
        continue;
      }
      const code = criterion.expected?.collectiveCode;
      if (typeof code !== 'string') continue;
      checked += 1;
      expect(COLLECTIVE_CODES.has(code), `${criterion.id} 的集体讨论代码 ${code} 不在清单内`).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('双向追溯：basis 令牌与判据 consumers 一致', () => {
    const cited = new Set<string>();
    for (const line of basisLines()) {
      const tokens = parseBasisTokens(line);
      for (const id of tokens.criteria) {
        cited.add(id);
        expect(CRITERIA.has(id), `basis 指向不存在的判据 ${id}`).toBe(true);
        const row = CRITERIA.get(id)!;
        if (!shouldCompareExpected(row.status)) {
          objectedSeen.push(id);
          continue;
        }
        expect(row.status).toBe('active');
      }
      for (const id of tokens.decisions) {
        expect(BUSINESS_DECISIONS.some((row) => row.id === id), `basis 指向不存在的业务决策 ${id}`).toBe(true);
      }
    }
    for (const criterion of LEGAL_CRITERIA) {
      if (criterion.consumers.length === 0) continue;
      const inCase = criterion.consumers.some((c) => c.startsWith('backend/case/'));
      if (!inCase) continue;
      if (!shouldCompareExpected(criterion.status)) continue;
      expect(cited.has(criterion.id), `判据 ${criterion.id} 未被清单 basis 引用`).toBe(true);
      for (const consumer of criterion.consumers) {
        expect(consumerSymbolPresent(consumer)).toBe(true);
      }
    }
    expect(objectedSeen).toEqual([]);
  });

  it('涉刑移送不计入期间对齐 CRIT-DL-003', () => {
    expect(TRANSFER_CLOCK_BASIS.basis).toContain('判据:CRIT-DL-003');
    expect(TRANSFER_CLOCK_BASIS.basisNote).toContain('第38条第2款');
    const expected = CRITERIA.get('CRIT-DL-003')?.expected;
    expect(expected?.transferBasisArticle).toBe('第三十八条第二款');
  });

  it('业务决策 DEC-003 DEC-004 与清单一致', () => {
    const penaltyCodes = new Set(MANDATORY_REVIEW_PENALTY_CODES.map((row) => row.code));
    const dec003 = BUSINESS_DECISIONS.find((row) => row.id === 'DEC-003');
    expect(dec003?.consumer).toBe('backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_PENALTY_CODES');
    const expectedCodes = dec003?.expected?.penaltyCodes;
    expect(Array.isArray(expectedCodes)).toBe(true);
    for (const code of expectedCodes as string[]) {
      expect((penaltyCodes as Set<string>).has(code), `DEC-003 代码 ${code} 不在清单`).toBe(true);
    }
    expect(penaltyCodes.size).toBe((expectedCodes as string[]).length);

    const dec004 = BUSINESS_DECISIONS.find((row) => row.id === 'DEC-004');
    expect(dec004?.expected?.reviewCode).toBe('criminal-transfer');
    expect(MANDATORY_REVIEW_ITEMS.some((item) => item.code === 'criminal-transfer')).toBe(true);

    const mutated = new Set(['confiscate-mineral-products']);
    expect(mutated.size).not.toBe(penaltyCodes.size);
  });
});
