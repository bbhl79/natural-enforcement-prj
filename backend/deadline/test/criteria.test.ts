// 用途：反向校验期限规则与 L1 判据底稿一致；含双向追溯、变异探测与 objected 语义。
// 调用方：backend/deadline 包的 vitest 用例（pnpm -r test）。
// 边界：只读常量，不连库、不写盘。判据口径变更走 docs/research/criteria/ 底稿与生成器。
// 依据：docs/research/criteria/README.md；docs/handoff-l1.md。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decisionValuesAgree,
  parseBasisTokens,
  shouldCompareExpected,
  valuesAgree,
} from '../../../tools/criteria-reverse-helpers.ts';
import {
  BUSINESS_DECISIONS,
  COMPLEX_CASE_REASON,
  DEADLINE_RULES,
  DEFAULT_EXTENSION_CAP_DAYS,
  LEGAL_CRITERIA,
  checkExtension,
} from '../src/index.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CRITERIA = new Map(LEGAL_CRITERIA.map((criterion) => [criterion.id, criterion]));
const DECISIONS = new Map(BUSINESS_DECISIONS.map((decision) => [decision.id, decision]));
// 推导父项：产物不含 derivation 链，仅在本模块约定为空 consumers 的父项编号。
const DERIVATION_ONLY_PARENTS = new Set(['CRIT-DL-004A', 'CRIT-DL-004B']);

// 从源码读 consumers 路径#符号，核对符号在场。
function consumerSymbolPresent(consumer: string): boolean {
  const [rel, symbol] = consumer.split('#');
  if (!rel || !symbol) return false;
  const text = readFileSync(join(REPO, rel), 'utf8');
  return text.includes(symbol);
}

// 反向校验：规则登记表的每条数值都能追溯到底稿判据或业务决策。
// 双向追溯期限规则登记表与 L1 判据底稿的一致性。
describe('期限规则与 L1 判据的反向校验（docs/research/criteria）', () => {
  const objectedSeen: string[] = [];

  it('shouldCompareExpected：objected 跳过数值比对', () => {
    expect(shouldCompareExpected('active')).toBe(true);
    expect(shouldCompareExpected('objected')).toBe(false);
    expect(shouldCompareExpected('superseded')).toBe(true);
  });

  it('每条判据 consumers 在场或属推导父项', () => {
    const ids = new Set(LEGAL_CRITERIA.map((row) => row.id));
    for (const criterion of LEGAL_CRITERIA) {
      expect(ids.has(criterion.id)).toBe(true);
      if (criterion.consumers.length === 0) {
        expect(
          DERIVATION_ONLY_PARENTS.has(criterion.id),
          `${criterion.id} 无 consumers 且不是登记的推导父项`,
        ).toBe(true);
        expect(criterion.status).toBe('active');
        continue;
      }
      for (const consumer of criterion.consumers) {
        expect(consumerSymbolPresent(consumer), `${criterion.id} 消费方 ${consumer} 不在场`).toBe(true);
      }
    }
  });

  it('每条规则的 basis 都指向在场判据或业务决策，且期望值一致', () => {
    const citedCriteria = new Set<string>();
    const citedDecisions = new Set<string>();

    for (const rule of DEADLINE_RULES) {
      const tokens = parseBasisTokens(rule.basis);
      expect(tokens.criteria.length + tokens.decisions.length, `${rule.key} 的 basis 未指向判据或业务决策`).toBeGreaterThan(
        0,
      );
      for (const id of tokens.criteria) citedCriteria.add(id);
      for (const id of tokens.decisions) citedDecisions.add(id);

      for (const id of tokens.criteria) {
        const criterion = CRITERIA.get(id);
        expect(criterion, `${rule.key} 引用了不存在的判据 ${id}`).toBeDefined();
        if (!criterion) continue;
        if (!shouldCompareExpected(criterion.status)) {
          objectedSeen.push(id);
          continue;
        }
        expect(criterion.status, `${id} 不是 active`).toBe('active');
        if (shouldCompareExpected(criterion.status)) {
          expect(valuesAgree(rule, criterion.expected ?? {}), `${rule.key} 与 ${id} 期望值不一致`).toBe(true);
        }
      }

      for (const id of tokens.decisions) {
        const decision = DECISIONS.get(id);
        expect(decision, `${rule.key} 引用了不存在的业务决策 ${id}`).toBeDefined();
        if (decision) {
          expect(decision.consumer, `${id} 的消费方不是 ${rule.key}`).toBe(
            `backend/deadline/src/rules.ts#${rule.key}`,
          );
          if (decision.expected) {
            expect(decisionValuesAgree(rule, decision.expected), `${rule.key} 与 ${id}.expected 不一致`).toBe(true);
          }
        }
      }
    }

    for (const criterion of LEGAL_CRITERIA) {
      if (criterion.consumers.length === 0) continue;
      if (!shouldCompareExpected(criterion.status)) continue;
      const mustCite = criterion.consumers.some((c) => c.startsWith('backend/deadline/src/rules.ts#'));
      if (!mustCite) continue;
      expect(citedCriteria.has(criterion.id), `判据 ${criterion.id} 未被任何规则 basis 引用`).toBe(true);
    }

    for (const decision of BUSINESS_DECISIONS) {
      if (!decision.consumer.startsWith('backend/deadline/src/rules.ts#')) continue;
      expect(citedDecisions.has(decision.id), `业务决策 ${decision.id} 未被规则 basis 引用`).toBe(true);
    }

    expect(objectedSeen).toEqual([]);
  });

  it('延长上限与业务决策的消费方都与规则登记表一致', () => {
    const dl002 = CRITERIA.get('CRIT-DL-002');
    if (dl002 && shouldCompareExpected(dl002.status)) {
      const extensionCap = dl002.expected?.extensionCapDays;
      expect(typeof extensionCap).toBe('number');
      expect(DEFAULT_EXTENSION_CAP_DAYS).toBe(extensionCap);
    }
    expect(checkExtension(30, '').ok).toBe(true);
    expect(checkExtension(31, '').ok).toBe(false);
    expect(checkExtension(31, COMPLEX_CASE_REASON).ok).toBe(true);

    const ruleKeys = new Set(DEADLINE_RULES.map((rule) => rule.key));
    for (const decision of BUSINESS_DECISIONS) {
      const matched = /^backend\/deadline\/src\/rules\.ts#(.+)$/u.exec(decision.consumer);
      if (matched) expect(ruleKeys.has(matched[1]), `${decision.id} 的消费方规则不在登记表内`).toBe(true);
    }
  });

  it('变异探测：错误天数不得通过 valuesAgree', () => {
    const handle = DEADLINE_RULES.find((row) => row.key === 'case.handle');
    const hearing = DEADLINE_RULES.find((row) => row.key === 'hearing.apply');
    const statement = DEADLINE_RULES.find((row) => row.key === 'notice.statement');
    const transferDec = DEADLINE_RULES.find((row) => row.key === 'criminal-transfer.decision');
    const reviewDec = DEADLINE_RULES.find((row) => row.key === 'criminal-decision.review');
    const legalReview = DEADLINE_RULES.find((row) => row.key === 'legal-review.round');
    expect(handle).toBeDefined();
    expect(valuesAgree({ ...handle!, dayCount: 60 }, { dayCount: 90, ruleKey: 'case.handle' })).toBe(false);
    expect(valuesAgree({ ...hearing!, dayCount: 3 }, { dayCount: 5 })).toBe(false);
    expect(valuesAgree({ ...statement!, dayCount: 3 }, { dayCount: 5 })).toBe(false);
    expect(valuesAgree({ ...transferDec!, dayCount: 5 }, { dayCount: 3 })).toBe(false);
    expect(valuesAgree({ ...reviewDec!, dayCount: 5, dayBasis: 'calendar' }, { dayCount: 3, dayBasis: 'calendar' })).toBe(
      false,
    );
    expect(
      valuesAgree({ ...legalReview!, dayCount: 3, extensionAllowance: 10 }, {
        ruleKey: 'legal-review.round',
        dayCount: 5,
        extensionAllowance: 10,
      }),
    ).toBe(false);
    expect(
      valuesAgree({ ...legalReview!, dayCount: 5, extensionAllowance: 5 }, {
        ruleKey: 'legal-review.round',
        dayCount: 5,
        extensionAllowance: 10,
      }),
    ).toBe(false);
    expect(DEFAULT_EXTENSION_CAP_DAYS).not.toBe(15);
    expect(COMPLEX_CASE_REASON).not.toBe('案情复杂');
  });
});
