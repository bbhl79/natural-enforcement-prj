import fs from 'node:fs/promises';
import path from 'node:path';

import { summaryStatus } from './auth-gate.cjs';
import { discoverUncovered, type ScenarioMeta, type UncoveredItem } from './discover/uncovered.ts';
import { repoRoot } from './paths.ts';

export interface RunManifest {
  runId: string;
  startedAt: string;
  endedAt: string | null;
  environment: string;
  scenarios: string[];
}

export interface StepRecord {
  scenarioId: string;
  stepId: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  evidence: string[];
  failures?: unknown[];
}

export interface RunSummary {
  status: 'passed' | 'failed' | 'blocked';
  failed: string[];
  runDir: string;
  /** 发现器信号源 1：本跑次机械推导的结构化缺口（spec #322 T1）。 */
  uncovered: UncoveredItem[];
}

export class EvidenceWriter {
  readonly runDir: string;
  private readonly manifest: RunManifest;
  private readonly failed: string[] = [];
  private readonly records: StepRecord[] = [];
  private readonly scenarioMeta: Record<string, ScenarioMeta> = {};

  constructor(runId: string, scenarios: string[], environment = 'verify-local') {
    this.runDir = path.join(repoRoot(), '.run', `verify-${runId}`);
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

    if (!record.pass && !isNonProductMiss(record)) {
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

/**
 * 未验证与环境 blocked 不计入产品失败。
 * 未验证：latent 或权威缺口。环境 blocked：栈／认证不可用，不改记业务失败。
 */
export function isNonProductMiss(record: StepRecord): boolean {
  if (record.pass) return false;
  if (typeof record.actual !== 'object' || record.actual === null) return false;
  const actual = record.actual as { evaluation?: unknown; disposition?: unknown };
  return actual.evaluation === 'unverified'
    || actual.evaluation === 'unevaluated'
    || actual.evaluation === 'product-gap'
    || actual.evaluation === 'not-in-slice'
    || actual.disposition === 'environment-blocked';
}

/** 生成短 runId。 */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${rand}`;
}
