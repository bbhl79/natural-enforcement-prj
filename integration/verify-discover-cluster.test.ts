// seam（spec #322 二期 T6 / 票 #328）：失败聚类去重 + GitHub 动作层 + 证据 loader。
// 纯函数用例不连库；动作层注入内存 fake gh（不触网、不真开票）；loader 用 os.tmpdir() 沙盒。
// 入口 ./dev test integration 仍会重建 it_template。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyFailure,
  clusterFailures,
  failureMarker,
  type FailureCluster,
  type FailureRecord,
} from '../.cursor/skills/verify-natural-enforcement/harness/discover/cluster-failures.ts';
import {
  applyFailureClusters,
  type GhPort,
} from '../.cursor/skills/verify-natural-enforcement/harness/apply-failure-clusters.ts';
import { loadFailureRecords } from '../.cursor/skills/verify-natural-enforcement/harness/load-failure-records.ts';

function rec(
  overrides: Partial<FailureRecord> & Pick<FailureRecord, 'scenarioId' | 'stepId'>,
): FailureRecord {
  return {
    runId: 'run-a',
    pass: false,
    expected: {},
    actual: {},
    evidence: [],
    ...overrides,
  };
}

/** 一条形态完整的 assert 失败项（形状对齐 harness/oracle.ts 的 AssertFailure）。 */
function assertFailure(path: string, message = `${path} 失败`) {
  return { path, op: 'eq' as const, expected: 'x', actual: 'y', message };
}

describe('classifyFailure（T6：失败记录 → 去重键；粒度到 step）', () => {
  it('末步多条 assert 失败合成一个键，路径排序去重，不按单条 assert 拆键', () => {
    const record = rec({
      scenarioId: 'vf-sc-auto-verify-land-success',
      stepId: 'side-effects',
      expected: { assert: [{ path: 'body.facts.clueStatus', op: 'eq', value: 'in_pool' }] },
      failures: [
        assertFailure('body.facts.mayDecide', 'm-mayDecide'),
        assertFailure('body.facts.clueStatus', 'm-clueStatus'),
        assertFailure('body.facts.clueStatus', 'm-clueStatus-dup'),
      ],
    });

    const classified = classifyFailure(record);
    expect(classified).not.toBeNull();
    expect(classified?.failureKind).toBe('assert:body.facts.clueStatus+body.facts.mayDecide');
    expect(classified?.assertPaths).toEqual(['body.facts.clueStatus', 'body.facts.mayDecide']);
    expect(classified?.key).toBe(
      JSON.stringify([
        'vf-sc-auto-verify-land-success',
        'side-effects',
        'assert:body.facts.clueStatus+body.facts.mayDecide',
      ]),
    );
  });

  it('中间步动作失败（expected.note=intermediate，无 failures）→ step-failed', () => {
    const classified = classifyFailure(
      rec({
        scenarioId: 'vf-sc-auto-verify-land-empty-failed',
        stepId: 'assign-org',
        expected: { note: 'intermediate' },
        actual: { http: { status: 409 }, body: { result: 'invalid-state' } },
      }),
    );
    expect(classified?.failureKind).toBe('step-failed');
  });

  it('末步 strictSteps 派生红（failures 空、expected.assert 在）不单独成簇', () => {
    const classified = classifyFailure(
      rec({
        scenarioId: 'vf-sc-auto-verify-land-empty-failed',
        stepId: 'side-effects',
        expected: { assert: [{ path: 'http.status', op: 'eq', value: 200 }] },
        failures: [],
      }),
    );
    expect(classified).toBeNull();
  });

  it('skip 记录（latent/driver 跳过）不是失败聚类对象', () => {
    expect(
      classifyFailure(
        rec({
          scenarioId: 'vf-sc-latent-decision',
          stepId: 'skip',
          expected: { status: 'runnable' },
          actual: { status: 'latent' },
        }),
      ),
    ).toBeNull();
  });

  it('pass:true 的记录不聚类（含 decide 跳过等 pass 为真的记录）', () => {
    expect(
      classifyFailure(
        rec({
          scenarioId: 'vf-sc-decide',
          stepId: 'decide',
          pass: true,
          actual: { note: { skipped: true }, body: { result: 'skipped' } },
        }),
      ),
    ).toBeNull();
  });

  it('空 steps 记录 → empty-steps', () => {
    const classified = classifyFailure(
      rec({
        scenarioId: 'vf-sc-empty',
        stepId: 'empty',
        expected: { steps: 'non-empty' },
      }),
    );
    expect(classified?.failureKind).toBe('empty-steps');
  });

  it('blocked 认证门禁：HTTP 401 与 403 同键 blocked:auth-rejected', () => {
    const blocked = (error: string) =>
      rec({
        scenarioId: '_harness',
        stepId: 'blocked',
        expected: { ok: true },
        actual: { error },
      });
    const a = classifyFailure(blocked('认证门禁停止。原因 auth-rejected。HTTP 401。'));
    const b = classifyFailure(blocked('认证门禁停止。原因 auth-rejected。HTTP 403。'));
    expect(a?.failureKind).toBe('blocked:auth-rejected');
    expect(b?.failureKind).toBe('blocked:auth-rejected');
    expect(a?.key).toBe(b?.key);
  });

  it('blocked 假图层 overlay → blocked:overlay-exit', () => {
    const classified = classifyFailure(
      rec({
        scenarioId: '_harness',
        stepId: 'blocked',
        expected: { ok: true },
        actual: { error: '假图层 overlay on 退出 1' },
      }),
    );
    expect(classified?.failureKind).toBe('blocked:overlay-exit');
  });

  it('_ui 钩子聚合失败 → ui-hook:<only>', () => {
    const classified = classifyFailure(
      rec({
        scenarioId: '_ui',
        stepId: 'failure',
        expected: { exit: 0 },
        actual: { error: '页面取证 failure 退出 1' },
      }),
    );
    expect(classified?.failureKind).toBe('ui-hook:failure');
  });
});

describe('clusterFailures（T6：同键归并、跨跑次证据合并）', () => {
  it('两份跑次同键失败归一个簇并保留两条证据；不同 stepId 各自成簇', () => {
    const runA = rec({
      runId: 'run-a',
      scenarioId: 'vf-sc-a',
      stepId: 'side-effects',
      failures: [assertFailure('body.facts.clueStatus')],
    });
    const runB = rec({
      runId: 'run-b',
      scenarioId: 'vf-sc-a',
      stepId: 'side-effects',
      failures: [assertFailure('body.facts.clueStatus')],
    });
    const otherStep = rec({
      runId: 'run-b',
      scenarioId: 'vf-sc-a',
      stepId: 'assign-org',
      expected: { note: 'intermediate' },
    });

    const clusters = clusterFailures([runA, runB, otherStep]);
    expect(clusters).toHaveLength(2);

    const byStep = new Map(clusters.map((cluster) => [cluster.stepId, cluster]));
    expect(byStep.get('side-effects')?.evidence.map((item) => item.runId)).toEqual(['run-a', 'run-b']);
    expect(byStep.get('assign-org')?.failureKind).toBe('step-failed');
  });
});

interface FakeIssue {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string;
  url: string;
  closedAt: string | null;
}

/** 内存 gh 假执行器：不触网、不真开票，记录 create/comment/reopen 调用。 */
class FakeGh implements GhPort {
  readonly issues: FakeIssue[] = [];
  readonly comments: { issueNumber: number; body: string }[] = [];
  readonly creates: { title: string; body: string; labels: readonly string[] }[] = [];
  private nextNumber = 1;

  seed(input: { state: 'open' | 'closed'; body: string; closedAt?: string | null }): FakeIssue {
    const issue: FakeIssue = {
      number: this.nextNumber++,
      state: input.state,
      title: '人工登记票',
      body: input.body,
      url: `fake://issue/${this.nextNumber - 1}`,
      closedAt: input.closedAt ?? null,
    };
    this.issues.push(issue);
    return issue;
  }

  async list(state: 'open' | 'closed'): Promise<FakeIssue[]> {
    return this.issues.filter((issue) => issue.state === state).map((issue) => ({ ...issue }));
  }

  async create(input: {
    title: string;
    body: string;
    labels: readonly string[];
  }): Promise<{ number: number; url: string }> {
    this.creates.push(input);
    const issue: FakeIssue = {
      number: this.nextNumber++,
      state: 'open',
      title: input.title,
      body: input.body,
      url: `fake://issue/${this.nextNumber - 1}`,
      closedAt: null,
    };
    this.issues.push(issue);
    return { number: issue.number, url: issue.url };
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    this.require(issueNumber);
    this.comments.push({ issueNumber, body });
  }

  async reopen(issueNumber: number, comment: string): Promise<void> {
    const issue = this.require(issueNumber);
    issue.state = 'open';
    issue.closedAt = null;
    this.comments.push({ issueNumber, body: comment });
  }

  private require(issueNumber: number): FakeIssue {
    const issue = this.issues.find((item) => item.number === issueNumber);
    if (issue === undefined) throw new Error(`fake gh：issue #${issueNumber} 不存在`);
    return issue;
  }
}

/** 构造一条末步 assert 失败记录（同键两跑次只需换 runId）。 */
function failingSideEffects(runId: string): FailureRecord {
  return rec({
    runId,
    scenarioId: 'vf-sc-auto-verify-land-success',
    stepId: 'side-effects',
    expected: { assert: [{ path: 'body.facts.clueStatus', op: 'eq', value: 'in_pool' }] },
    failures: [assertFailure('body.facts.clueStatus')],
    source: 'steps/vf-sc-auto-verify-land-success/side-effects.json',
  });
}

describe('applyFailureClusters（T6：GitHub 动作层，fake gh）', () => {
  it('首见失败 → 只立一张 needs-triage 票，正文含机器键 marker 与证据路径', async () => {
    const gh = new FakeGh();
    const clusters: FailureCluster[] = clusterFailures([failingSideEffects('run-a')]);

    const [result] = await applyFailureClusters(clusters, gh);

    expect(result.action).toBe('create');
    expect(gh.creates).toHaveLength(1);
    expect(gh.creates[0].labels).toEqual(['needs-triage']);
    expect(gh.creates[0].body).toContain(failureMarker(clusters[0].key));
    expect(gh.creates[0].body).toContain('run-a');
    expect(gh.creates[0].body).toContain('steps/vf-sc-auto-verify-land-success/side-effects.json');
    expect(gh.comments).toHaveLength(0);
    expect(gh.issues).toHaveLength(1);
  });

  it('同键已有开放票 → 不立新票，评论补证据（跨跑次证据链）', async () => {
    const gh = new FakeGh();
    const first = clusterFailures([failingSideEffects('run-a')]);
    await applyFailureClusters(first, gh);
    expect(gh.issues).toHaveLength(1);

    const second = clusterFailures([failingSideEffects('run-b')]);
    const [result] = await applyFailureClusters(second, gh);

    expect(result.action).toBe('comment');
    expect(gh.creates).toHaveLength(1);
    expect(gh.issues).toHaveLength(1);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0].issueNumber).toBe(gh.issues[0].number);
    expect(gh.comments[0].body).toContain('run-b');
  });

  it('票关闭后同键复发 → 重开并附复发证据，不立新票', async () => {
    const gh = new FakeGh();
    const clusters = clusterFailures([failingSideEffects('run-b')]);
    gh.seed({ state: 'closed', body: `历史票\n${failureMarker(clusters[0].key)}\n`, closedAt: '2026-11-01T00:00:00Z' });

    const [result] = await applyFailureClusters(clusters, gh);

    expect(result.action).toBe('reopen');
    expect(gh.issues[0].state).toBe('open');
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0].issueNumber).toBe(gh.issues[0].number);
    expect(gh.comments[0].body).toContain('run-b');
    expect(gh.creates).toHaveLength(0);
  });

  it('多张同键关闭票 → 重开最近关闭的一张', async () => {
    const gh = new FakeGh();
    const clusters = clusterFailures([failingSideEffects('run-c')]);
    const marker = failureMarker(clusters[0].key);
    const older = gh.seed({ state: 'closed', body: marker, closedAt: '2026-10-01T00:00:00Z' });
    const newer = gh.seed({ state: 'closed', body: marker, closedAt: '2026-11-01T00:00:00Z' });

    const [result] = await applyFailureClusters(clusters, gh);

    expect(result.action).toBe('reopen');
    expect(gh.comments[0].issueNumber).toBe(newer.number);
    expect(older.state).toBe('closed');
  });

  it('无 marker 的人工票（#319 形态）不被评论；同键无票时并行立新票（并存归并）', async () => {
    const gh = new FakeGh();
    const manual = gh.seed({ state: 'open', body: '## BACKLOG\n- [ ] 人工登记缺口，无机器键\n' });
    const clusters = clusterFailures([failingSideEffects('run-a')]);

    await applyFailureClusters(clusters, gh);

    // 人工票保持原样、零评论；新失败另立一张带 marker 的票，两者并存。
    expect(manual.state).toBe('open');
    expect(manual.body).toContain('人工登记缺口');
    expect(gh.comments).toHaveLength(0);
    expect(gh.creates).toHaveLength(1);
    expect(gh.issues).toHaveLength(2);
    expect(gh.issues[1].body).toContain(failureMarker(clusters[0].key));
  });

  it('注入重复失败证据 → 归并为一票一评论链', async () => {
    const gh = new FakeGh();
    await applyFailureClusters(clusterFailures([failingSideEffects('run-a')]), gh);
    await applyFailureClusters(clusterFailures([failingSideEffects('run-b')]), gh);

    expect(gh.issues).toHaveLength(1);
    expect(gh.creates).toHaveLength(1);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0].body).toContain('run-b');
  });

  it('同一轮内两条同键记录 → 单簇单票（簇内证据去重前先去重键）', async () => {
    const gh = new FakeGh();
    const clusters = clusterFailures([
      failingSideEffects('run-a'),
      failingSideEffects('run-a'),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].evidence).toHaveLength(1);

    await applyFailureClusters(clusters, gh);
    expect(gh.issues).toHaveLength(1);
    expect(gh.comments).toHaveLength(0);
  });
});

/** 递归列文件（posix 相对路径），用于证明 loader 只读不写。 */
async function walkFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

const sandboxRoots: string[] = [];
afterEach(async () => {
  for (const root of sandboxRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

/** 在 tmpdir 铺一个最小证据包：manifest + steps 文件。 */
async function seedRun(
  root: string,
  runId: string,
  files: Readonly<Record<string, unknown>>,
): Promise<string> {
  const runDir = path.join(root, `verify-${runId}`);
  await fs.mkdir(path.join(runDir, 'steps'), { recursive: true });
  await fs.writeFile(
    path.join(runDir, 'manifest.json'),
    `${JSON.stringify(
      { runId, startedAt: '2026-11-08T00:00:00Z', endedAt: null, environment: 'test', scenarios: [] },
      null,
      2,
    )}\n`,
    'utf8',
  );
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(runDir, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  }
  return runDir;
}

describe('loadFailureRecords（T6：证据 loader，discover/ 之外，只读）', () => {
  it('runId 取自 manifest；stepId 取自 JSON 正文（文件名变形不影响）；source 为包内相对路径', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-cluster-loader-'));
    sandboxRoots.push(root);
    const runDir = await seedRun(root, 'run-loader', {
      // safeId 会把空格替换为 _，文件名与 stepId 不同，必须读 JSON 内 stepId。
      'steps/vf-sc-a/side_effects.json': {
        scenarioId: 'vf-sc-a',
        stepId: 'side effects',
        pass: false,
        expected: { assert: [{ path: 'body.x', op: 'eq', value: 1 }] },
        actual: { http: { status: 200 } },
        evidence: [],
        failures: [assertFailure('body.x')],
      },
    });

    const records = await loadFailureRecords([runDir]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      runId: 'run-loader',
      scenarioId: 'vf-sc-a',
      stepId: 'side effects',
      pass: false,
      source: 'steps/vf-sc-a/side_effects.json',
    });
    expect(records[0].failures).toEqual([assertFailure('body.x')]);
  });

  it('一跑次全类型记录：skip 与 pass:true 由聚类排除；assert/step-failed/blocked/ui 各自成簇', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-cluster-loader-'));
    sandboxRoots.push(root);
    const runDir = await seedRun(root, 'run-full', {
      'steps/vf-sc-a/side-effects.json': {
        scenarioId: 'vf-sc-a',
        stepId: 'side-effects',
        pass: false,
        expected: { assert: [{ path: 'body.x', op: 'eq', value: 1 }] },
        actual: {},
        evidence: ['evidence/vf-sc-a/side-effects-response.json'],
        failures: [assertFailure('body.x')],
      },
      'steps/vf-sc-a/assign-org.json': {
        scenarioId: 'vf-sc-a',
        stepId: 'assign-org',
        pass: false,
        expected: { note: 'intermediate' },
        actual: { http: { status: 409 } },
        evidence: [],
      },
      'steps/vf-sc-latent/skip.json': {
        scenarioId: 'vf-sc-latent',
        stepId: 'skip',
        pass: false,
        expected: { status: 'runnable' },
        actual: { status: 'latent' },
        evidence: [],
      },
      'steps/vf-sc-decide/decide.json': {
        scenarioId: 'vf-sc-decide',
        stepId: 'decide',
        pass: true,
        expected: { assert: [] },
        actual: { note: { skipped: true } },
        evidence: [],
      },
      'steps/_harness/blocked.json': {
        scenarioId: '_harness',
        stepId: 'blocked',
        pass: false,
        expected: { ok: true },
        actual: { error: '认证门禁停止。原因 auth-rejected。HTTP 401。' },
        evidence: [],
      },
      'steps/_ui/failure.json': {
        scenarioId: '_ui',
        stepId: 'failure',
        pass: false,
        expected: { exit: 0 },
        actual: { error: '页面取证 failure 退出 1' },
        evidence: [],
      },
      // 非法记录与坏 JSON：忽略而非崩溃。
      'steps/broken/not-a-record.json': { foo: 1 },
    });
    await fs.writeFile(path.join(runDir, 'steps/broken/bad.json'), '{not json', 'utf8');

    const clusters = clusterFailures(await loadFailureRecords([runDir]));

    expect(clusters.map((cluster) => cluster.failureKind).sort()).toEqual([
      'assert:body.x',
      'blocked:auth-rejected',
      'step-failed',
      'ui-hook:failure',
    ]);
  });

  it('两份跑次同键失败：loader 多跑次输入 → 单簇两条证据（跨跑次归并）', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-cluster-loader-'));
    sandboxRoots.push(root);
    const step = {
      scenarioId: 'vf-sc-a',
      stepId: 'side-effects',
      pass: false,
      expected: { assert: [{ path: 'body.x', op: 'eq', value: 1 }] },
      actual: {},
      evidence: [],
      failures: [assertFailure('body.x')],
    };
    const runA = await seedRun(root, 'run-a', { 'steps/vf-sc-a/side-effects.json': step });
    const runB = await seedRun(root, 'run-b', { 'steps/vf-sc-a/side-effects.json': step });

    const clusters = clusterFailures(await loadFailureRecords([runA, runB]));

    expect(clusters).toHaveLength(1);
    expect(clusters[0].evidence.map((item) => item.runId)).toEqual(['run-a', 'run-b']);
  });

  it('loader 只读：读前后证据包文件清单与内容零变化', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-cluster-loader-'));
    sandboxRoots.push(root);
    const runDir = await seedRun(root, 'run-ro', {
      'steps/vf-sc-a/side-effects.json': {
        scenarioId: 'vf-sc-a',
        stepId: 'side-effects',
        pass: false,
        expected: { assert: [] },
        actual: {},
        evidence: [],
        failures: [assertFailure('body.x')],
      },
    });
    const before = await walkFiles(runDir);

    await loadFailureRecords([runDir]);

    expect(await walkFiles(runDir)).toEqual(before);
  });

  it('blocked 跑次只聚 _harness 门禁记录，不把先前业务失败入账（blocked 不改记业务失败）', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-cluster-loader-'));
    sandboxRoots.push(root);
    const runDir = await seedRun(root, 'run-blocked', {
      'steps/vf-sc-a/side-effects.json': {
        scenarioId: 'vf-sc-a',
        stepId: 'side-effects',
        pass: false,
        expected: { assert: [] },
        actual: {},
        evidence: [],
        failures: [assertFailure('body.x')],
      },
      'steps/_harness/blocked.json': {
        scenarioId: '_harness',
        stepId: 'blocked',
        pass: false,
        expected: { ok: true },
        actual: { error: '认证门禁停止。原因 auth-rejected。HTTP 401。' },
        evidence: [],
      },
    });
    await fs.writeFile(
      path.join(runDir, 'summary.json'),
      `${JSON.stringify({ status: 'blocked', failed: [], runDir, uncovered: [] }, null, 2)}\n`,
      'utf8',
    );

    const clusters = clusterFailures(await loadFailureRecords([runDir]));

    expect(clusters.map((cluster) => cluster.failureKind)).toEqual(['blocked:auth-rejected']);
  });

  it('缺 manifest.json → 抛错（runId 不靠目录名猜测）', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-cluster-loader-'));
    sandboxRoots.push(root);
    const runDir = path.join(root, 'verify-no-manifest');
    await fs.mkdir(path.join(runDir, 'steps'), { recursive: true });

    await expect(loadFailureRecords([runDir])).rejects.toThrow(/manifest\.json/);
  });
});
