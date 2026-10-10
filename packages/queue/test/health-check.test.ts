// 健康检查任务单测（#55，unit 层无库）。
// 系统设施任务（对队列基础设施本身的探测），非业务 worker——G5 不可扩大条件的
// 测试侧表达：任务名固定 system.* 命名空间，载荷回显 probeId，消费结果可独立断言。
import { describe, expect, it, vi } from 'vitest';

import {
  HEALTH_CHECK_JOB,
  runHealthCheckJob,
  type HealthCheckPayload,
} from '../src/health-check.ts';

describe('健康检查任务（#55 系统设施任务）', () => {
  it('任务名落在 system.* 设施命名空间（业务 worker 不得占用）', () => {
    expect(HEALTH_CHECK_JOB).toBe('system.health-check');
  });

  it('消费任务时执行注入的连通探针，并回显 probeId 与探针结果', async () => {
    const ping = vi.fn(async () => 'PONG');
    const payload: HealthCheckPayload = {
      probeId: 'probe-1',
      issuedAt: '2026-10-10T00:00:00.000Z',
    };

    const result = await runHealthCheckJob(payload, ping);

    expect(ping).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      probeId: 'probe-1',
      pong: 'PONG',
      consumedAt: expect.any(String),
    });
  });

  it('探针抛错时任务失败并透出原始错误（连通探测不得吞错报绿）', async () => {
    const ping = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      runHealthCheckJob({ probeId: 'probe-2', issuedAt: '2026-10-10T00:00:00.000Z' }, ping),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
