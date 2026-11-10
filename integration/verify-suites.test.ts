// 验证资产的覆盖自检：每个 scenario 必须落在某个执行面上，新增的场景不能悄悄没人跑。
// 不连库、不起服务，只读 fixtures 目录与 harness/suites.ts 的清单。
import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { negativesDir, runnableScenariosDir } from '../e2e/verify/harness/paths.ts';
import {
  API_SUITE,
  LAYER_OVERLAY_SUITE,
  UNWIRED_SCENARIOS,
} from '../e2e/verify/harness/suites.ts';

interface ScenarioHead {
  readonly id: string;
  readonly status?: string;
  readonly driver?: string;
}

async function scenarioHeads(dir: string): Promise<ScenarioHead[]> {
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (name) => {
      const head = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as ScenarioHead;
      expect(head.id, `${name} 的 id 必须与文件名一致`).toBe(name.replace(/\.json$/, ''));
      return head;
    }),
  );
}

async function allScenarios(): Promise<ScenarioHead[]> {
  return [...(await scenarioHeads(runnableScenariosDir())), ...(await scenarioHeads(negativesDir()))];
}

describe('验证资产覆盖自检', () => {
  it('清单之间没有重复，也没有同一场景挂在两个执行面', () => {
    const all = [...API_SUITE, ...LAYER_OVERLAY_SUITE, ...UNWIRED_SCENARIOS];
    expect(new Set(all).size).toBe(all.length);
  });

  it('API_SUITE 与 LAYER_OVERLAY_SUITE 里的场景都存在，且是 runnable 的 api 场景', async () => {
    const byId = new Map((await allScenarios()).map((head) => [head.id, head]));
    for (const id of [...API_SUITE, ...LAYER_OVERLAY_SUITE]) {
      const head = byId.get(id);
      expect(head, `${id} 在 fixtures 里不存在`).toBeDefined();
      expect(head?.status, `${id} 不是 runnable`).toBe('runnable');
      expect(head?.driver, `${id} 不是 api 驱动`).toBe('api');
    }
  });

  it('每个 api 驱动的场景都被 API_SUITE 或 LAYER_OVERLAY_SUITE 消费', async () => {
    const consumed = new Set([...API_SUITE, ...LAYER_OVERLAY_SUITE]);
    const missing = (await allScenarios())
      .filter((head) => head.status === 'runnable' && head.driver === 'api')
      .map((head) => head.id)
      .filter((id) => !consumed.has(id));
    expect(missing, '这些 api 场景没有任何执行面消费，请加进 suites.ts 的清单').toEqual([]);
  });

  it('没有驱动字段的 runnable 旧稿恰好等于 UNWIRED_SCENARIOS（棘轮：只减不增）', async () => {
    const legacy = (await allScenarios())
      .filter((head) => head.status === 'runnable' && head.driver === undefined)
      .map((head) => head.id)
      .sort();
    expect(legacy).toEqual([...UNWIRED_SCENARIOS].sort());
  });
});
