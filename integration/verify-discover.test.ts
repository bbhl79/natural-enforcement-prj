// seam①（spec #322 Q16）：uncovered 推导纯函数。
// 构造步骤记录与 scenario 元数据 → 断言 uncovered[] shape。
// 纯函数用例不连库；入口 ./dev test integration 仍会重建 it_template。
import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discoverUncovered,
  type DiscoverInput,
} from '../e2e/verify/harness/discover/uncovered.ts';
import {
  EvidenceWriter,
  newRunId,
  type StepRecord,
} from '../e2e/verify/harness/evidence.ts';

function skipStatus(scenarioId: string, status: string): StepRecord {
  return {
    scenarioId,
    stepId: 'skip',
    pass: false,
    expected: { status: 'runnable' },
    actual: { status },
    evidence: [],
  };
}

// spec #322 Q16 seam①：由步骤记录推导 uncovered 缺口，覆盖各类跳过原因。
describe('discoverUncovered（seam①：步骤记录 → uncovered[]）', () => {
  it('latent scenario 被跳过 → latent-skipped，带 scenarioId 与首个 featureMapRef，不带 stepId', () => {
    const input: DiscoverInput = {
      steps: [skipStatus('vf-sc-latent-decision', 'latent')],
      scenarios: {
        'vf-sc-latent-decision': {
          featureMapRefs: ['nav.case.validity'],
          steps: [],
        },
      },
      runnableIndex: ['vf-sc-latent-decision'],
    };

    expect(discoverUncovered(input)).toEqual([
      {
        kind: 'latent-skipped',
        scenarioId: 'vf-sc-latent-decision',
        featureMapRef: 'nav.case.validity',
        reason: expect.any(String),
      },
    ]);
  });

  it('featureMapRefs 为空 → latent-skipped 省略 featureMapRef', () => {
    const input: DiscoverInput = {
      steps: [skipStatus('vf-sc-latent-close', 'latent')],
      scenarios: { 'vf-sc-latent-close': { featureMapRefs: [], steps: [] } },
      runnableIndex: ['vf-sc-latent-close'],
    };

    expect(discoverUncovered(input)).toEqual([
      {
        kind: 'latent-skipped',
        scenarioId: 'vf-sc-latent-close',
        reason: expect.any(String),
      },
    ]);
  });

  it('driver 非 api 被跳过 → driver-mismatch，带 scenarioId，不带 stepId', () => {
    const input: DiscoverInput = {
      steps: [
        {
          scenarioId: 'vf-sc-ui-only',
          stepId: 'skip',
          pass: false,
          expected: { driver: 'api' },
          actual: { driver: null },
          evidence: [],
        },
      ],
      scenarios: {
        'vf-sc-ui-only': {
          featureMapRefs: ['nav.workbench.register'],
          steps: [],
        },
      },
      runnableIndex: ['vf-sc-ui-only'],
    };

    expect(discoverUncovered(input)).toEqual([
      {
        kind: 'driver-mismatch',
        scenarioId: 'vf-sc-ui-only',
        featureMapRef: 'nav.workbench.register',
        reason: expect.any(String),
      },
    ]);
  });

  it('decide 步因非 pending_decision 跳过 → step-skipped，带 stepId', () => {
    const input: DiscoverInput = {
      steps: [
        {
          scenarioId: 'vf-sc-decide',
          stepId: 'decide',
          pass: true,
          expected: { note: 'intermediate' },
          actual: {
            http: { status: 200 },
            body: { result: 'skipped', reason: 'not-pending-decision', clueStatus: 'in_pool' },
            note: { action: 'decide', skipped: true, clueStatus: 'in_pool' },
          },
          evidence: [],
        },
      ],
      scenarios: {
        'vf-sc-decide': {
          featureMapRefs: ['nav.case.decision'],
          steps: [{ id: 'decide', action: 'decide' }],
        },
      },
      runnableIndex: ['vf-sc-decide'],
    };

    const uncovered = discoverUncovered(input);
    expect(uncovered).toEqual([
      {
        kind: 'step-skipped',
        scenarioId: 'vf-sc-decide',
        stepId: 'decide',
        featureMapRef: 'nav.case.decision',
        reason: expect.any(String),
      },
    ]);
    expect(uncovered[0].reason).toContain('not-pending-decision');
  });

  it('read-dispatch-buttons 矩阵省略开关 → 每步聚合一条 switch-unchecked', () => {
    const input: DiscoverInput = {
      steps: [
        {
          scenarioId: 'vf-sc-buttons',
          stepId: 'read-buttons',
          pass: true,
          expected: { note: 'intermediate' },
          actual: {
            http: { status: 200 },
            body: { result: 'button-matrix', facts: { clueStatus: 'in_pool', rows: [] } },
            note: { action: 'read-dispatch-buttons', misses: [], facts: { clueStatus: 'in_pool', rows: [] } },
          },
          evidence: [],
        },
      ],
      scenarios: {
        'vf-sc-buttons': {
          featureMapRefs: ['nav.workbench.dispatch.buttons'],
          steps: [
            {
              id: 'read-buttons',
              action: 'read-dispatch-buttons',
              matrix: [
                { identityRef: 'intake-a', mayDecide: true, mayAssignOrg: true },
                { identityRef: 'intake-st' },
              ],
            },
          ],
        },
      },
      runnableIndex: ['vf-sc-buttons'],
    };

    const uncovered = discoverUncovered(input);
    expect(uncovered).toEqual([
      {
        kind: 'switch-unchecked',
        scenarioId: 'vf-sc-buttons',
        stepId: 'read-buttons',
        featureMapRef: 'nav.workbench.dispatch.buttons',
        reason: expect.any(String),
      },
    ]);
    expect(uncovered[0].reason).toContain('mayReassignOrg');
  });

  it('矩阵四个开关全写 → 不报 switch-unchecked', () => {
    const input: DiscoverInput = {
      steps: [
        {
          scenarioId: 'vf-sc-buttons-full',
          stepId: 'read-buttons',
          pass: true,
          expected: { note: 'intermediate' },
          actual: { http: { status: 200 }, body: { result: 'button-matrix' }, note: {} },
          evidence: [],
        },
      ],
      scenarios: {
        'vf-sc-buttons-full': {
          steps: [
            {
              id: 'read-buttons',
              action: 'read-dispatch-buttons',
              matrix: [
                {
                  identityRef: 'intake-a',
                  mayDecide: true,
                  mayAssignOrg: true,
                  mayAssignPeople: false,
                  mayReassignOrg: false,
                },
              ],
            },
          ],
        },
      },
      runnableIndex: ['vf-sc-buttons-full'],
    };

    expect(discoverUncovered(input)).toEqual([]);
  });

  it('应跑全集登记但无步骤记录 → scenario-not-run，带首个 featureMapRef', () => {
    const input: DiscoverInput = {
      steps: [
        {
          scenarioId: 'vf-sc-ran',
          stepId: 'register',
          pass: true,
          expected: { assert: [] },
          actual: { http: { status: 201 }, body: { result: 'registered' } },
          evidence: [],
        },
      ],
      scenarios: {
        'vf-sc-ran': { steps: [] },
        'vf-sc-missing': { featureMapRefs: ['nav.workbench.register'], steps: [] },
      },
      runnableIndex: ['vf-sc-ran', 'vf-sc-missing'],
    };

    expect(discoverUncovered(input)).toEqual([
      {
        kind: 'scenario-not-run',
        scenarioId: 'vf-sc-missing',
        featureMapRef: 'nav.workbench.register',
        reason: expect.any(String),
      },
    ]);
  });

  it('应跑全集都产生记录且无跳过/未核 → uncovered 为空（零误报基线）', () => {
    const input: DiscoverInput = {
      steps: [
        {
          scenarioId: 'vf-sc-ran',
          stepId: 'register',
          pass: true,
          expected: { assert: [] },
          actual: { http: { status: 201 }, body: { result: 'registered' } },
          evidence: [],
        },
      ],
      scenarios: { 'vf-sc-ran': { steps: [{ id: 'register', action: 'register-clue' }] } },
      runnableIndex: ['vf-sc-ran'],
    };

    expect(discoverUncovered(input)).toEqual([]);
  });
});

// spec #322 T1 验收：summary.json 挂载结构化 uncovered，且不改变原有通过语义。
describe('EvidenceWriter.finish() 挂载 uncovered[]（T1 验收）', () => {
  it('含 latent/skip 的跑批：summary.json 出现结构化 uncovered，failed 语义不变', async () => {
    const writer = new EvidenceWriter(newRunId(), ['vf-sc-latent-decision']);
    await writer.init();
    writer.registerScenario('vf-sc-latent-decision', {
      featureMapRefs: ['nav.case.validity'],
      steps: [],
    });
    await writer.writeStep(skipStatus('vf-sc-latent-decision', 'latent'));

    const summary = await writer.finish('passed');

    // skip 记录 pass:false → 既有 failed 语义不变；latent 不得记 passed。
    expect(summary.status).toBe('failed');
    expect(summary.failed).toEqual(['vf-sc-latent-decision/skip']);
    expect(summary.uncovered).toEqual([
      {
        kind: 'latent-skipped',
        scenarioId: 'vf-sc-latent-decision',
        featureMapRef: 'nav.case.validity',
        reason: expect.any(String),
      },
    ]);

    const onDisk = JSON.parse(
      await fs.readFile(path.join(writer.runDir, 'summary.json'), 'utf8'),
    ) as { uncovered: unknown };
    expect(onDisk.uncovered).toEqual(summary.uncovered);
  });

  it('passed 跑批仍挂 uncovered：step-skipped 不改 passed 语义', async () => {
    const writer = new EvidenceWriter(newRunId(), ['vf-sc-decide']);
    await writer.init();
    writer.registerScenario('vf-sc-decide', {
      featureMapRefs: [],
      steps: [{ id: 'decide', action: 'decide' }],
    });
    await writer.writeStep({
      scenarioId: 'vf-sc-decide',
      stepId: 'decide',
      pass: true,
      expected: { note: 'intermediate' },
      actual: {
        body: { result: 'skipped', reason: 'not-pending-decision' },
        note: { action: 'decide', skipped: true },
      },
      evidence: [],
    });

    const summary = await writer.finish('passed');

    expect(summary.status).toBe('passed');
    expect(summary.failed).toEqual([]);
    expect(summary.uncovered).toEqual([
      {
        kind: 'step-skipped',
        scenarioId: 'vf-sc-decide',
        stepId: 'decide',
        reason: expect.any(String),
      },
    ]);
  });

  it('blocked 跑次语义不变，仍挂 uncovered：未跑场景记 scenario-not-run', async () => {
    const writer = new EvidenceWriter(newRunId(), ['vf-sc-ran', 'vf-sc-not-run']);
    await writer.init();
    writer.registerScenario('vf-sc-ran', { steps: [] });
    await writer.writeStep({
      scenarioId: 'vf-sc-ran',
      stepId: 'register',
      pass: true,
      expected: { assert: [] },
      actual: { http: { status: 201 }, body: { result: 'registered' } },
      evidence: [],
    });
    await writer.writeStep({
      scenarioId: '_harness',
      stepId: 'blocked',
      pass: false,
      expected: { ok: true },
      actual: { error: 'transport-unreachable' },
      evidence: [],
    });

    const summary = await writer.finish('blocked');

    expect(summary.status).toBe('blocked');
    expect(summary.uncovered).toEqual([
      {
        kind: 'scenario-not-run',
        scenarioId: 'vf-sc-not-run',
        reason: expect.any(String),
      },
    ]);
  });
});