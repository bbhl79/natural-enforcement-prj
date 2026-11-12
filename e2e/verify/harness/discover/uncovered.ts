// 用途：从步骤记录机械推导 uncovered 缺口列表。
// 发现器信号源 1（spec #322 首期 T1）：步骤记录 → uncovered[]。
// 纯函数，无 I/O。harness 机械推导，禁人手写。
import type { StepRecord } from '../evidence.ts';
import { recordOf } from '../record-of.ts';
import { BUTTON_FLAGS } from '../dispatch-buttons.ts';

/** uncovered 缺口类别（spec #322 Q2 枚举）。 */
export type UncoveredKind =
  | 'latent-skipped'
  | 'driver-mismatch'
  | 'step-skipped'
  | 'switch-unchecked'
  | 'scenario-not-run';

/** 一条结构化缺口。diff 键 = kind+scenarioId+stepId+featureMapRef（T2）。 */
export interface UncoveredItem {
  kind: UncoveredKind;
  scenarioId?: string;
  stepId?: string;
  featureMapRef?: string;
  reason: string;
}

/** read-dispatch-buttons 矩阵行期望；省略的开关即未核。http/reason 由 runner 核对，推导不读。 */
export interface MatrixExpectMeta {
  readonly identityRef: string;
  readonly mayDecide?: boolean;
  readonly mayAssignOrg?: boolean;
  readonly mayAssignPeople?: boolean;
  readonly mayReassignOrg?: boolean;
}

/** scenario 步骤元数据（只取推导所需字段）。 */
export interface ScenarioStepMeta {
  readonly id: string;
  readonly action: string;
  readonly matrix?: readonly MatrixExpectMeta[];
}

/**
 * scenario 元数据（只取推导所需字段；由调用方传入，不耦合 fixture 加载）。
 * status/driver 缺口由 StepRecord 的 expected/actual 检测，meta 不承载。
 */
export interface ScenarioMeta {
  readonly featureMapRefs?: readonly string[];
  readonly steps?: readonly ScenarioStepMeta[];
}

/** 纯函数输入：实跑步骤记录 + scenario 元数据 + 应跑全集。 */
export interface DiscoverInput {
  readonly steps: readonly StepRecord[];
  readonly scenarios: Readonly<Record<string, ScenarioMeta>>;
  readonly runnableIndex: readonly string[];
}

/** featureMapRef 单值映射：取 scenario.featureMapRefs 首元素（非空时），否则省略。 */
function featureMapRefOf(meta: ScenarioMeta | undefined): { featureMapRef?: string } {
  const ref = meta?.featureMapRefs?.[0];
  return ref !== undefined && ref !== '' ? { featureMapRef: ref } : {};
}

/** 步骤记录 → 结构化 uncovered[]。 */
export function discoverUncovered(input: DiscoverInput): UncoveredItem[] {
  const items: UncoveredItem[] = [];
  const ranScenarioIds = new Set<string>();
  const switchReported = new Set<string>();

  for (const record of input.steps) {
    ranScenarioIds.add(record.scenarioId);
    const expected = recordOf(record.expected);
    const actual = recordOf(record.actual);
    const meta = input.scenarios[record.scenarioId];

    // latent-skipped：skip 记录期望 status=runnable，实际非 runnable（latent 等）。
    if (
      record.stepId === 'skip' &&
      expected?.status === 'runnable' &&
      actual !== null &&
      actual.status !== 'runnable'
    ) {
      items.push({
        kind: 'latent-skipped',
        scenarioId: record.scenarioId,
        ...featureMapRefOf(meta),
        reason: `scenario 状态=${String(actual.status)}，期望 runnable，跳过未覆盖`,
      });
      continue;
    }

    // driver-mismatch：skip 记录期望 driver=api，实际 driver 非 api。
    if (record.stepId === 'skip' && expected?.driver === 'api') {
      items.push({
        kind: 'driver-mismatch',
        scenarioId: record.scenarioId,
        ...featureMapRefOf(meta),
        reason: `scenario driver=${String(actual?.driver)}，harness 只跑 api，跳过未覆盖`,
      });
      continue;
    }

    // step-skipped：步骤自身跳过（decide 非 pending_decision 等），pass 仍可为 true。
    const note = recordOf(actual?.note);
    const body = recordOf(actual?.body);
    if (note?.skipped === true || body?.result === 'skipped') {
      const why = body?.reason ?? note?.reason ?? '';
      items.push({
        kind: 'step-skipped',
        scenarioId: record.scenarioId,
        stepId: record.stepId,
        ...featureMapRefOf(meta),
        reason: `步骤跳过：${String(why)}`,
      });
      continue;
    }

    // switch-unchecked：read-dispatch-buttons 矩阵行省略的开关即未核。
    // 按步骤聚合一条（diff 键含 stepId，不含 flag/identity）；只针对实跑步骤。
    const stepDef = meta?.steps?.find((step) => step.id === record.stepId);
    if (stepDef?.action === 'read-dispatch-buttons' && stepDef.matrix !== undefined) {
      const key = `${record.scenarioId}/${record.stepId}`;
      if (!switchReported.has(key)) {
        const omitted: string[] = [];
        for (const row of stepDef.matrix) {
          for (const flag of BUTTON_FLAGS) {
            if (row[flag] === undefined) omitted.push(`${row.identityRef}.${flag}`);
          }
        }
        if (omitted.length > 0) {
          switchReported.add(key);
          items.push({
            kind: 'switch-unchecked',
            scenarioId: record.scenarioId,
            stepId: record.stepId,
            ...featureMapRefOf(meta),
            reason: `未核开关：${omitted.join('、')}`,
          });
        }
      }
    }
  }

  // scenario-not-run：应跑全集登记，但本跑次无任何步骤记录。
  for (const scenarioId of input.runnableIndex) {
    if (!ranScenarioIds.has(scenarioId)) {
      items.push({
        kind: 'scenario-not-run',
        scenarioId,
        ...featureMapRefOf(input.scenarios[scenarioId]),
        reason: '应跑全集登记此 scenario，但本跑次无步骤记录',
      });
    }
  }

  return items;
}
