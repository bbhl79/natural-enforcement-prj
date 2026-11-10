// 不连 docker。核对 SourceGate 名单仍在基础编排，以及旅程门禁与故障 fail-closed。
import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateJourneyIsolation,
  planHistoryDiff,
  refuseCompletedRun,
} from '../.cursor/skills/verify-natural-enforcement/harness/journey-isolation.ts';

describe('SourceGate 名单透传未被故障变量替换', () => {
  it('基础编排同时保留 NE_SOURCE_GATE_ALLOWED_SOURCES，且不含 VERIFY_FAULT', async () => {
    const text = await fs.readFile(path.join(process.cwd(), 'infra/docker-compose.yml'), 'utf8');
    expect(text).toMatch(/^ {6}NE_SOURCE_GATE_ALLOWED_SOURCES: "\$\{NE_SOURCE_GATE_ALLOWED_SOURCES:-\}"/m);
    expect(text).not.toMatch(/^ {6}VERIFY_FAULT:/m);
    const overlay = await fs.readFile(
      path.join(
        process.cwd(),
        '.cursor/skills/verify-natural-enforcement/harness/layers/docker-compose.verify-fault.yml',
      ),
      'utf8',
    );
    expect(overlay).toMatch(/^ {6}VERIFY_FAULT:/m);
    expect(overlay).not.toMatch(/^ {6}NE_SOURCE_GATE_ALLOWED_SOURCES:/m);
  });
});

describe('旅程隔离门禁', () => {
  const dedicated = {
    COMPOSE_PROJECT_NAME: 'verify-journey-iso',
    NE_DEPLOYMENT: 'verify',
    NODE_ENV: 'development',
    VERIFY_ISOLATION: 'dedicated',
    POSTGRES_PORT: '15432',
    REDIS_PORT: '16379',
    RUSTFS_PORT: '19000',
    RUSTFS_CONSOLE_PORT: '19001',
    NGINX_PORT: '18080',
  };

  it('默认项目、普通 dev、共享端口、production 都不允许 up', () => {
    expect(evaluateJourneyIsolation({}).ok).toBe(false);
    expect(evaluateJourneyIsolation({ ...dedicated, COMPOSE_PROJECT_NAME: 'natural-enforcement' }).upAllowed).toBe(false);
    expect(evaluateJourneyIsolation({ ...dedicated, NE_DEPLOYMENT: 'dev' }).ok).toBe(false);
    expect(evaluateJourneyIsolation({ ...dedicated, NODE_ENV: 'production' }).ok).toBe(false);
    expect(evaluateJourneyIsolation({ ...dedicated, POSTGRES_PORT: '5432' }).reasons.join(' ')).toContain('5432');
    expect(evaluateJourneyIsolation({ ...dedicated, COMPOSE_PROJECT_NAME: 'verify-e3-stack' }).ok).toBe(false);
    const ok = evaluateJourneyIsolation(dedicated);
    expect(ok).toMatchObject({ ok: true, upAllowed: true, sourceGateBypass: false, project: 'verify-journey-iso' });
  });
});

describe('跑次不覆写与历史比较', () => {
  it('passed 与 failed 拒绝覆写，blocked 不是已完成', () => {
    expect(refuseCompletedRun('passed')).toBe(true);
    expect(refuseCompletedRun('failed')).toBe(true);
    expect(refuseCompletedRun('blocked')).toBe(false);
    expect(refuseCompletedRun(null)).toBe(false);
  });

  it('无基线是首次运行；显式 blocked 基线不比较；同一基线可比较', () => {
    expect(planHistoryDiff('', [])).toEqual({ status: 'first-run', baselineRunId: null });
    expect(
      planHistoryDiff('base', [{ runId: 'base', status: 'blocked', endedAt: '2026-11-08T00:00:00Z' }]),
    ).toEqual({ status: 'blocked-baseline', baselineRunId: 'base' });
    expect(
      planHistoryDiff('base', [{ runId: 'base', status: 'passed', endedAt: null }]),
    ).toEqual({ status: 'interrupted', baselineRunId: 'base' });
    expect(
      planHistoryDiff('base', [
        { runId: 'inject', status: 'failed', endedAt: '2026-11-08T02:00:00Z' },
        { runId: 'base', status: 'passed', endedAt: '2026-11-08T01:00:00Z' },
      ]),
    ).toEqual({ status: 'compared', baselineRunId: 'base' });
  });
});
