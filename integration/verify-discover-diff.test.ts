// seam②④（spec #322 Q16）：跨跑次 diff + 基线选择 + ack 过滤 + 报告写口。
// 纯函数用例不连库；report 用例用可注入 root（临时目录），不碰产品文件。
// 入口 ./dev test integration 仍会重建 it_template。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  diffUncovered,
  filterAcked,
  selectBaseline,
  type CoverageAck,
  type RunSnapshot,
} from '../.cursor/skills/verify-natural-enforcement/harness/discover/diff-runs.ts';
import { writeDiffReport } from '../.cursor/skills/verify-natural-enforcement/harness/discover/report.ts';
import type { UncoveredItem } from '../.cursor/skills/verify-natural-enforcement/harness/discover/uncovered.ts';

describe('diffUncovered（seam②：跨跑次新增/消失）', () => {
  it('current 新缺口入 added，baseline 消失缺口入 removed，共有缺口不报', () => {
    const common: UncoveredItem = {
      kind: 'latent-skipped',
      scenarioId: 'vf-sc-latent-decision',
      featureMapRef: 'nav.case.validity',
      reason: '共有缺口',
    };
    const gone: UncoveredItem = {
      kind: 'step-skipped',
      scenarioId: 'vf-sc-decide',
      stepId: 'decide',
      reason: '上跑次有、本跑次消失',
    };
    const fresh: UncoveredItem = {
      kind: 'switch-unchecked',
      scenarioId: 'vf-sc-buttons',
      stepId: 'read-buttons',
      featureMapRef: 'nav.workbench.dispatch.buttons',
      reason: '本跑次新增',
    };

    expect(diffUncovered([common, gone], [common, fresh])).toEqual({
      added: [fresh],
      removed: [gone],
    });
  });
});

function snap(
  runId: string,
  status: RunSnapshot['status'],
  startedAt: string,
  endedAt: string | null,
): RunSnapshot {
  return { runId, status, startedAt, endedAt, uncovered: [] };
}

describe('selectBaseline（seam②：基线取最近非 blocked 跑次）', () => {
  it('blocked 跑次时间最近也不入账，取最近的非 blocked 跑次', () => {
    const older = snap('r1', 'passed', '2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z');
    const latestAccounted = snap('r3', 'failed', '2026-11-02T00:00:00Z', '2026-11-02T01:00:00Z');
    const blockedRecent = snap('r2', 'blocked', '2026-11-03T00:00:00Z', '2026-11-03T01:00:00Z');

    expect(selectBaseline([older, blockedRecent, latestAccounted])).toBe(latestAccounted);
  });

  it('全部 blocked 或空列表 → 无基线（null）', () => {
    expect(selectBaseline([snap('b1', 'blocked', '2026-11-01T00:00:00Z', null)])).toBeNull();
    expect(selectBaseline([])).toBeNull();
  });

  it('endedAt 缺省时回退 startedAt 排序', () => {
    const ended = snap('e1', 'passed', '2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z');
    const inProgress = snap('e2', 'failed', '2026-11-02T00:00:00Z', null);

    expect(selectBaseline([ended, inProgress])).toBe(inProgress);
  });
});

describe('filterAcked（seam④：已 ack 地图节点不再报）', () => {
  it('featureMapRef 命中地图节点 ack 的缺口被过滤，未命中与无 featureMapRef 的保留', () => {
    const acked: UncoveredItem = {
      kind: 'switch-unchecked',
      scenarioId: 'vf-sc-buttons',
      stepId: 'read-buttons',
      featureMapRef: 'nav.workbench.dispatch.buttons',
      reason: 'r',
    };
    const kept: UncoveredItem = {
      kind: 'latent-skipped',
      scenarioId: 'vf-sc-latent-decision',
      featureMapRef: 'nav.case.validity',
      reason: 'r',
    };
    const noRef: UncoveredItem = {
      kind: 'scenario-not-run',
      scenarioId: 'vf-sc-missing',
      reason: 'r',
    };
    const acks: CoverageAck[] = [
      { key: 'nav.workbench.dispatch.buttons', keyType: 'feature-map-node' },
    ];

    expect(filterAcked([acked, kept, noRef], acks)).toEqual([kept, noRef]);
  });

  it('路由类 ack 首期不参与地图节点过滤（留 T5）', () => {
    const item: UncoveredItem = {
      kind: 'switch-unchecked',
      scenarioId: 'vf-sc-buttons',
      stepId: 'read-buttons',
      featureMapRef: 'nav.workbench.dispatch.buttons',
      reason: 'r',
    };
    const routeAcks: CoverageAck[] = [
      { key: 'nav.workbench.dispatch.buttons', keyType: 'route' },
    ];

    expect(filterAcked([item], routeAcks)).toEqual([item]);
  });
});

describe('writeDiffReport（seam②④：报告写口 + ack 过滤 + 写边界）', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-report-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('两跑次产出 diff 报告：新增/消失正确，已 ack 键不入报告，只写 .run/discover/<runId>/', async () => {
    const gapA: UncoveredItem = {
      kind: 'latent-skipped',
      scenarioId: 'vf-sc-common',
      featureMapRef: 'nav.common',
      reason: '共有',
    };
    const gapB: UncoveredItem = {
      kind: 'step-skipped',
      scenarioId: 'vf-sc-gone',
      stepId: 'decide',
      featureMapRef: 'nav.gone',
      reason: '消失',
    };
    const gapC: UncoveredItem = {
      kind: 'switch-unchecked',
      scenarioId: 'vf-sc-acked',
      stepId: 'read-buttons',
      featureMapRef: 'nav.acked',
      reason: '新增但已 ack',
    };
    const gapD: UncoveredItem = {
      kind: 'scenario-not-run',
      scenarioId: 'vf-sc-new',
      featureMapRef: 'nav.unacked',
      reason: '新增未 ack',
    };
    const baseline: RunSnapshot = {
      runId: 'base',
      status: 'passed',
      startedAt: '2026-11-01T00:00:00Z',
      endedAt: '2026-11-01T01:00:00Z',
      uncovered: [gapA, gapB],
    };
    const current: RunSnapshot = {
      runId: 'cur',
      status: 'failed',
      startedAt: '2026-11-02T00:00:00Z',
      endedAt: '2026-11-02T01:00:00Z',
      uncovered: [gapA, gapC, gapD],
    };
    const acks: CoverageAck[] = [{ key: 'nav.acked', keyType: 'feature-map-node' }];

    const report = await writeDiffReport({ current, history: [baseline], acks, root });

    expect(report).toEqual({
      runId: 'cur',
      baselineRunId: 'base',
      added: [gapD],
      removed: [gapB],
    });
    const file = path.join(root, '.run', 'discover', 'cur', 'diff-report.json');
    const onDisk: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk).toEqual(report);
    expect(JSON.stringify(onDisk)).not.toContain('nav.acked');
    expect(await fs.readdir(root)).toEqual(['.run']);
  });

  it('runId 逃逸 .run/ → 抛错，sandbox 内不写任何文件', async () => {
    const current: RunSnapshot = {
      runId: '../../escape',
      status: 'passed',
      startedAt: '2026-11-02T00:00:00Z',
      endedAt: '2026-11-02T01:00:00Z',
      uncovered: [],
    };

    await expect(writeDiffReport({ current, history: [], acks: [], root })).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });
});