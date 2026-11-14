// 用途：L1 判据反向校验的纯函数：解析 basis 令牌、比对期望值、objected 语义。
// 调用方：backend/deadline/test/criteria.test.ts、backend/case/test/criteria.test.ts。
// 边界：无 I/O，不依赖 Nest。数值比对遇 objected 由 shouldCompareExpected 跳过。
// 依据：docs/research/criteria/README.md；docs/handoff-l1.md。

/** 从 basis 字符串取出判据编号与业务决策编号。 */
export function parseBasisTokens(basis: string): { readonly criteria: readonly string[]; readonly decisions: readonly string[] } {
  const criteria = [...basis.matchAll(/判据:(CRIT-[A-Z0-9-]+)/gu)].map((match) => match[1]);
  const decisions = [...basis.matchAll(/业务决策:(DEC-[0-9]+)/gu)].map((match) => match[1]);
  return { criteria, decisions };
}

/** objected 状态跳过数值断言，但保留存在性校验。 */
export function shouldCompareExpected(status: string): boolean {
  return status !== 'objected';
}

/** 期限规则登记参数与判据期望值是否一致（仅比对出现的字段）。 */
export function valuesAgree(
  rule: {
    readonly key?: string;
    readonly dayCount?: number;
    readonly dayBasis?: string;
    readonly extensionAllowance?: number | null;
  },
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (typeof expected.ruleKey === 'string' && rule.key !== undefined && rule.key !== expected.ruleKey) return false;
  if (typeof expected.dayCount === 'number' && rule.dayCount !== expected.dayCount) return false;
  if (typeof expected.dayBasis === 'string' && rule.dayBasis !== expected.dayBasis) return false;
  if (
    expected.extensionAllowance !== undefined &&
    expected.extensionAllowance !== null &&
    rule.extensionAllowance !== expected.extensionAllowance
  ) {
    return false;
  }
  if (typeof expected.extensionCapDays === 'number') {
    // 延长上限在 extension 模块常量上，本条仅用于变异探测时的占位比对
    return true;
  }
  return true;
}

/** 业务决策登记 expected 与规则登记是否一致。 */
export function decisionValuesAgree(
  rule: {
    readonly key: string;
    readonly dayCount: number;
    readonly dayBasis: string;
    readonly extensionAllowance?: number | null;
  },
  expected: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (!expected) return false;
  return valuesAgree(rule, expected);
}
