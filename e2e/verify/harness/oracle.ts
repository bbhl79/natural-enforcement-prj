// 用途：按 RUN-CONTRACT 定义的比较操作符评估场景结构化断言。
// 调用方：run-api-scenario.ts。
/** 结构化 oracle 断言（见 fixtures/RUN-CONTRACT.md）。 */

/** 断言比较操作符；evaluateOracle 按此分派。 */
export type AssertOp = 'eq' | 'in' | 'includes' | 'gt' | 'lt';

/** 单条断言：点分 path、操作符与期望值；由场景夹具的 oracle.assert 提供。 */
export interface OracleAssert {
  readonly path: string;
  readonly op: AssertOp;
  readonly value: unknown;
}

/** 一步的观测结果：HTTP 状态与响应体；由 run-api-scenario.ts 构造。 */
export interface StepObservation {
  readonly http: { readonly status: number };
  readonly body: Record<string, unknown>;
}

/** 断言失败项：path、op、期望值、实际值与可读说明。 */
export interface AssertFailure {
  readonly path: string;
  readonly op: AssertOp;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
}

function readPath(root: StepObservation, dotted: string): unknown {
  const parts = dotted.split('.');
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function evalOne(obs: StepObservation, item: OracleAssert): AssertFailure | null {
  const actual = readPath(obs, item.path);
  switch (item.op) {
    case 'eq':
      if (actual === item.value) return null;
      return {
        path: item.path,
        op: item.op,
        expected: item.value,
        actual,
        message: `${item.path} expected eq ${JSON.stringify(item.value)}, got ${JSON.stringify(actual)}`,
      };
    case 'in': {
      if (!Array.isArray(item.value)) {
        return {
          path: item.path,
          op: item.op,
          expected: item.value,
          actual,
          message: `${item.path} op in requires array value`,
        };
      }
      if (item.value.includes(actual)) return null;
      return {
        path: item.path,
        op: item.op,
        expected: item.value,
        actual,
        message: `${item.path} expected in ${JSON.stringify(item.value)}, got ${JSON.stringify(actual)}`,
      };
    }
    case 'includes': {
      if (!Array.isArray(actual)) {
        return {
          path: item.path,
          op: item.op,
          expected: item.value,
          actual,
          message: `${item.path} op includes requires array actual`,
        };
      }
      if (actual.includes(item.value)) return null;
      return {
        path: item.path,
        op: item.op,
        expected: item.value,
        actual,
        message: `${item.path} expected includes ${JSON.stringify(item.value)}, got ${JSON.stringify(actual)}`,
      };
    }
    case 'gt':
    case 'lt': {
      const ok =
        typeof actual === 'number' &&
        typeof item.value === 'number' &&
        (item.op === 'gt' ? actual > item.value : actual < item.value);
      if (ok) return null;
      return {
        path: item.path,
        op: item.op,
        expected: item.value,
        actual,
        message: `${item.path} expected ${item.op} ${JSON.stringify(item.value)}, got ${JSON.stringify(actual)}`,
      };
    }
    default:
      return {
        path: item.path,
        op: item.op,
        expected: item.value,
        actual,
        message: `unknown op ${String(item.op)}`,
      };
  }
}

/** 评全部 assert；返回失败列表（空 = 通过）。 */
export function evaluateOracle(
  obs: StepObservation,
  asserts: readonly OracleAssert[],
): AssertFailure[] {
  const failures: AssertFailure[] = [];
  for (const item of asserts) {
    const fail = evalOne(obs, item);
    if (fail) failures.push(fail);
  }
  return failures;
}
