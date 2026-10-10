// 队列接口（QueuePort）与 BullMQ 适配器单测（#55，unit 层无库）。
// 接缝 = 队列抽象对 BullMQ 库的边界：mock bullmq（库边界 mock，非模块内部），
// 断言「经队列接口投递」与「按 JobRef 等待消费结果」两种对外行为。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addMock = vi.fn();
const waitUntilFinishedMock = vi.fn();
const queueCloseMock = vi.fn();
const eventsCloseMock = vi.fn();

class FakeJob {
  waitUntilFinished = waitUntilFinishedMock;
}

vi.mock('bullmq', () => ({
  Queue: class {
    add = addMock;
    close = queueCloseMock;
  },
  QueueEvents: class {
    close = eventsCloseMock;
  },
}));

import { createBullMqQueue } from '../src/bullmq-queue.ts';

describe('队列接口（QueuePort）经 BullMQ 适配器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addMock.mockResolvedValue(new FakeJob());
  });

  it('enqueue 按任务名与载荷经 BullMQ 真实投递，并返回 JobRef', async () => {
    addMock.mockResolvedValue({ id: 42 });
    const port = createBullMqQueue('system.health', {});

    const ref = await port.enqueue('system.health-check', { probeId: 'p-1' });

    expect(addMock).toHaveBeenCalledWith('system.health-check', { probeId: 'p-1' });
    expect(ref).toEqual({ id: '42' });
  });

  it('waitForCompletion 以 JobRef 等待该任务消费完成并返回结果', async () => {
    waitUntilFinishedMock.mockResolvedValue({ ok: true, probeId: 'p-1', pong: 'PONG' });
    const port = createBullMqQueue('system.health', {});
    const ref = await port.enqueue('system.health-check', { probeId: 'p-1' });

    const result = await port.waitForCompletion(ref, 10_000);

    expect(waitUntilFinishedMock).toHaveBeenCalledWith(expect.anything(), 10_000);
    expect(result).toEqual({ ok: true, probeId: 'p-1', pong: 'PONG' });
  });

  it('close 关闭队列与消费确认通道（进程级探测可干净退出）', async () => {
    queueCloseMock.mockResolvedValue(undefined);
    eventsCloseMock.mockResolvedValue(undefined);
    const port = createBullMqQueue('system.health', {});

    await port.close();

    expect(queueCloseMock).toHaveBeenCalledOnce();
    expect(eventsCloseMock).toHaveBeenCalledOnce();
  });
});
