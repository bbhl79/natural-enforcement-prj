// seam③（spec #322 Q16）：写边界门禁。
// 沙盒夹具仓跑发现器全流程，断言产品/fixtures/latent 零改动、只写 e2e/results/discover/<runId>/、
// 越界写入必抛错、report.ts 是 discover 唯一写口。
// 沙盒建在 os.tmpdir()（容器内 /tmp），afterEach 清理；不碰产品文件，不连库。
// 入口 ./dev test integration 仍会重建 it_template + tsc -p integration。
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoverageAck, RunSnapshot } from '../e2e/verify/harness/discover/diff-runs.ts';
import { writeDiffReport } from '../e2e/verify/harness/discover/report.ts';
import {
  discoverUncovered,
  type ScenarioMeta,
} from '../e2e/verify/harness/discover/uncovered.ts';
import type { StepRecord } from '../e2e/verify/harness/evidence.ts';

// ---- 沙盒夹具仓内容（独立已知字面量，非从被测代码重算）----

/** 产品样文件：发现器进程不得改动。 */
const PRODUCT_SAMPLE = `// 产品样文件（沙盒夹具，发现器不得改动）
import { Controller, Get } from '@nestjs/common';

@Controller('api/sample')
export class SampleController {
  @Get('ping')
  ping(): string {
    return 'pong';
  }
}
`;

const RUNNABLE_ID = 'vf-sc-runnable-sample';
const LATENT_ID = 'vf-sc-latent-sample';

const INDEX = { runnable: [RUNNABLE_ID], negatives: [], latent: [LATENT_ID] };

const RUNNABLE_SCENARIO = {
  id: RUNNABLE_ID,
  status: 'runnable',
  driver: 'api',
  featureMapRefs: ['nav.workbench.register'],
  steps: [{ id: 'register', action: 'register-clue' }],
};

/** latent 语料：status=latent，发现器只能报告缺口，不得提拔为 runnable。 */
const LATENT_SCENARIO = {
  id: LATENT_ID,
  status: 'latent',
  featureMapRefs: ['nav.case.validity'],
  steps: [{ id: 'noop', action: 'noop' }],
  oracle: { kind: 'future' },
};

const LATENT_REL = `fixtures/scenarios/latent/${LATENT_ID}.json`;
const RUNNABLE_REL = `fixtures/scenarios/runnable/${RUNNABLE_ID}.json`;
const ACKS_REL = 'fixtures/coverage-acks.json';

/** 递归列出目录下所有文件的相对路径（posix 分隔，稳定可比）。 */
async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full, base)));
    else if (ent.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** 文件内容快照：rel → sha256（byte 级）。跑前跑后比对即证零改动。 */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of await walk(dir)) {
    const bytes = await fs.readFile(path.join(dir, rel));
    out.set(rel, createHash('sha256').update(bytes).digest('hex'));
  }
  return out;
}

/** 在沙盒里铺一个最小夹具仓：产品样文件 + runnable/latent scenario + index + coverage-acks。 */
async function seedSandbox(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'product'), { recursive: true });
  await fs.writeFile(path.join(root, 'product', 'sample-controller.ts'), PRODUCT_SAMPLE, 'utf8');
  await fs.mkdir(path.join(root, 'fixtures/scenarios/runnable'), { recursive: true });
  await fs.mkdir(path.join(root, 'fixtures/scenarios/latent'), { recursive: true });
  await fs.writeFile(path.join(root, ACKS_REL), '[]\n', 'utf8');
  await fs.writeFile(
    path.join(root, 'fixtures/scenarios/index.json'),
    `${JSON.stringify(INDEX, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(path.join(root, RUNNABLE_REL), `${JSON.stringify(RUNNABLE_SCENARIO, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(root, LATENT_REL), `${JSON.stringify(LATENT_SCENARIO, null, 2)}\n`, 'utf8');
}

// spec #322 Q16 seam③：发现器全流程只在 e2e/results 下新增报告，产品与夹具零改动。
describe('seam③ 沙盒夹具仓：发现器全流程只写 e2e/results/，产品/fixtures/latent 零改动', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-boundary-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('读夹具→推导 uncovered→写报告：既有文件 byte 一致，latent 未提拔，唯一新增 e2e/results/discover/<runId>/diff-report.json', async () => {
    await seedSandbox(root);
    const before = await snapshot(root);

    // 全流程：从沙盒夹具读 scenario 元数据（只读），构造步骤记录，机械推导 uncovered。
    const scenarios: Record<string, ScenarioMeta> = {};
    for (const rel of [RUNNABLE_REL, LATENT_REL]) {
      const raw = JSON.parse(await fs.readFile(path.join(root, rel), 'utf8')) as { id: string } & ScenarioMeta;
      scenarios[raw.id] = {
        featureMapRefs: raw.featureMapRefs,
        steps: raw.steps,
      };
    }
    const steps: StepRecord[] = [
      // latent scenario 被跳过：期望 runnable，实际 latent。
      {
        scenarioId: LATENT_ID,
        stepId: 'skip',
        pass: false,
        expected: { status: 'runnable' },
        actual: { status: 'latent' },
        evidence: [],
      },
      // runnable scenario 正常跑通一步。
      {
        scenarioId: RUNNABLE_ID,
        stepId: 'register',
        pass: true,
        expected: { assert: [] },
        actual: { http: { status: 201 }, body: { result: 'registered' } },
        evidence: [],
      },
    ];
    const uncovered = discoverUncovered({ steps, scenarios, runnableIndex: INDEX.runnable });
    const current: RunSnapshot = {
      runId: 'sandbox-run',
      status: 'failed',
      startedAt: '2026-11-08T00:00:00Z',
      endedAt: '2026-11-08T01:00:00Z',
      uncovered,
    };
    const acks = JSON.parse(await fs.readFile(path.join(root, ACKS_REL), 'utf8')) as CoverageAck[];

    const report = await writeDiffReport({ current, history: [], acks, root });

    // 断言 1：既有文件（产品/fixtures/latent/index/coverage-acks）全部 byte 一致，无删除。
    const after = await snapshot(root);
    for (const [rel, hash] of before) {
      expect(after.get(rel), `既有文件被改动或删除：${rel}`).toBe(hash);
    }
    expect([...before.keys()].filter((rel) => !after.has(rel))).toEqual([]);

    // 断言 2：唯一新增文件是允许路径 e2e/results/discover/<runId>/diff-report.json。
    expect([...after.keys()].filter((rel) => !before.has(rel)).sort()).toEqual([
      'e2e/results/discover/sandbox-run/diff-report.json',
    ]);

    // 断言 3：latent 未被提拔（显式读回 scenario status）。
    const latentAfter = JSON.parse(await fs.readFile(path.join(root, LATENT_REL), 'utf8')) as { status: string };
    expect(latentAfter.status).toBe('latent');
    const runnableAfter = JSON.parse(await fs.readFile(path.join(root, RUNNABLE_REL), 'utf8')) as { status: string };
    expect(runnableAfter.status).toBe('runnable');

    // 断言 4：流程确实跑通——latent-skipped 入报告，报告落盘与返回值一致（未改夹具）。
    expect(report.added).toEqual([
      {
        kind: 'latent-skipped',
        scenarioId: LATENT_ID,
        featureMapRef: 'nav.case.validity',
        reason: expect.any(String),
      },
    ]);
    const onDisk: unknown = JSON.parse(
      await fs.readFile(path.join(root, 'e2e/results/discover/sandbox-run/diff-report.json'), 'utf8'),
    );
    expect(onDisk).toEqual(report);
  });

  it.each(['../../escape', '../../../outside-sandbox'])(
    'runId=%s 逃逸 e2e/results/ → 抛错而非静默写出，夹具仓零改动零新增',
    async (runId) => {
      await seedSandbox(root);
      const before = await snapshot(root);
      const current: RunSnapshot = {
        runId,
        status: 'passed',
        startedAt: '2026-11-08T00:00:00Z',
        endedAt: '2026-11-08T01:00:00Z',
        uncovered: [],
      };

      await expect(writeDiffReport({ current, history: [], acks: [], root })).rejects.toThrow();

      // 越界被拦截：沙盒完全一致（无改动、无新增、无删除）。../../escape 的落点仍在沙盒内，
      // 若被静默写出会被快照捕获。
      expect(await snapshot(root)).toEqual(before);
    },
  );
});

// spec #322 Q16 seam③：discover 写文件 API 只允许出现在 report.ts。
describe('seam③ 唯一写口守卫：discover 写文件 API 只在 report.ts', () => {
  it('harness/discover 下只有 report.ts 含写文件 API；uncovered.ts/diff-runs.ts 零 I/O', async () => {
    const discoverDir = path.join(
      process.cwd(),
      'e2e/verify/harness/discover',
    );
    // 写出/破坏性文件 API（镜像 auth-gate.test.cjs walk/scan 门禁风格）。
    const writeApi =
      /\b(?:writeFile|writeFileSync|writeSync|createWriteStream|mkdir|mkdirSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|truncate|truncateSync)\s*\(/;
    const fsImport = /from\s*['"]node:fs(?:\/promises)?['"]/;

    const writers: string[] = [];
    const ioFiles: string[] = [];
    for (const rel of await walk(discoverDir)) {
      if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue;
      const text = await fs.readFile(path.join(discoverDir, rel), 'utf8');
      if (writeApi.test(text)) writers.push(rel);
      if (fsImport.test(text) || writeApi.test(text)) ioFiles.push(rel);
    }

    // report.ts 是唯一写口；其余 discover 模块零 I/O（连 node:fs 都不 import）。
    expect(writers.sort()).toEqual(['report.ts']);
    expect(ioFiles.sort()).toEqual(['report.ts']);
  });
});