import fs from 'node:fs/promises';
import path from 'node:path';

import { summaryStatus } from './auth-gate.cjs';
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
}

export class EvidenceWriter {
  readonly runDir: string;
  private readonly manifest: RunManifest;
  private readonly failed: string[] = [];

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

  async writeStep(record: StepRecord, evidenceBody?: unknown): Promise<void> {
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
