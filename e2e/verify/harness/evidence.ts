// 用途：把一个跑次的步骤记录、证据响应与汇总写到 e2e/results 下，并推导 uncovered 缺口。
// 调用方：run-api-scenario.ts、run-api-suite.ts、run-next-todo-buttons.ts、run-auto-verification.ts、integration/verify-discover.test.ts。
import fs from 'node:fs/promises';
import path from 'node:path';

import { summaryStatus } from './auth-gate.cjs';
import { discoverUncovered, type ScenarioMeta, type UncoveredItem } from './discover/uncovered.ts';
import { repoRoot, RESULTS_DIR } from './paths.ts';

/** 跑次清单：runId、起止时间、环境与场景清单，落 manifest.json。 */
export interface RunManifest {
  runId: string;
  startedAt: string;
  endedAt: string | null;
  environment: string;
  scenarios: string[];
}

/** 一步的记录：是否通过、期望、实际与证据文件名；落 steps/ 目录。 */
export interface StepRecord {
  scenarioId: string;
  stepId: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  evidence: string[];
  failures?: unknown[];
}

/** 跑次汇总：总状态、失败步骤、产物目录与机械推导的 uncovered 缺口；落 summary.json。 */
export interface RunSummary {
  status: 'passed' | 'failed' | 'blocked';
  failed: string[];
  runDir: string;
  /** 发现器信号源 1：本跑次机械推导的结构化缺口（spec #322 T1）。 */
  uncovered: UncoveredItem[];
}

/** 跑次证据写入器：建目录、逐条写步骤与响应、结束时产出汇总。 */
export class EvidenceWriter {
  readonly runDir: string;
  private readonly manifest: RunManifest;
  private readonly failed: string[] = [];
  private readonly records: StepRecord[] = [];
  private readonly scenarioMeta: Record<string, ScenarioMeta> = {};

  constructor(runId: string, scenarios: string[], environment = 'verify-local') {
    this.runDir = path.join(repoRoot(), RESULTS_DIR, `verify-${runId}`);
    this.manifest = {
      runId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      environment,
      scenarios: [...scenarios],
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.runDir, 'steps'), { recursive: true });
    await fs.mkdir(path.join(this.runDir, 'evidence'), { recursive: true });
    await this.writeJson('manifest.json', this.manifest);
  }

  /** 调用方传入 scenario 元数据，供 finish() 推导 uncovered；本类不加载 fixture。 */
  registerScenario(scenarioId: string, meta: ScenarioMeta): void {
    this.scenarioMeta[scenarioId] = meta;
  }

  async writeStep(record: StepRecord, evidenceBody?: unknown): Promise<void> {
    this.records.push(record);
    const stepDir = path.join(this.runDir, 'steps', record.scenarioId);
    await fs.mkdir(stepDir, { recursive: true });
    const safeId = record.stepId.replace(/[^\w.-]+/g, '_');
    const stepFile = path.join(stepDir, `${safeId}.json`);
    await fs.writeFile(stepFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    if (evidenceBody !== undefined) {
      const evDir = path.join(this.runDir, 'evidence', record.scenarioId);
      await fs.mkdir(evDir, { recursive: true });
      const evFile = path.join(evDir, `${safeId}-response.json`);
      await fs.writeFile(evFile, `${JSON.stringify(evidenceBody, null, 2)}\n`, 'utf8');
    }

    if (!record.pass) {
      this.failed.push(`${record.scenarioId}/${record.stepId}`);
    }
  }

  async finish(status: RunSummary['status']): Promise<RunSummary> {
    this.manifest.endedAt = new Date().toISOString();
    await this.writeJson('manifest.json', this.manifest);
    const summary: RunSummary = {
      status: summaryStatus(status, this.failed.length),
      failed: [...this.failed],
      runDir: this.runDir,
      uncovered: discoverUncovered({
        steps: this.records,
        scenarios: this.scenarioMeta,
        runnableIndex: this.manifest.scenarios,
      }),
    };
    await this.writeJson('summary.json', summary);
    return summary;
  }

  private async writeJson(rel: string, value: unknown): Promise<void> {
    await fs.writeFile(path.join(this.runDir, rel), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

/** 生成短 runId。 */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}
