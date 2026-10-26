// 队列设施包的扩展契约单测（#213，unit 层无库、无 Redis）。
//
// 接缝 = 队列设施包的公共出口：投递参数、不可重试错误类型、业务 worker 工厂。
// 库边界（bullmq／ioredis）整体 mock，不测库自身行为；断言本包对库说了什么。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addMock = vi.fn();
const queueCloseMock = vi.fn();
const eventsCloseMock = vi.fn();
const workerCloseMock = vi.fn();

/** 起 worker 时 BullMQ 收到的处理器。 */
let capturedProcessor: ((job: { name: string; data: unknown; attemptsMade: number }) => Promise<unknown>) | null = null;

vi.mock('bullmq', () => ({
  Queue: class {
    add = addMock;
    close = queueCloseMock;
  },
  QueueEvents: class {
    close = eventsCloseMock;
  },
  Worker: class {
    close = workerCloseMock;
    constructor(
      _queueName: string,
      processor: (job: { name: string; data: unknown; attemptsMade: number }) => Promise<unknown>,
    ) {
      capturedProcessor = processor;
    }
  },
  UnrecoverableError: class extends Error {
    readonly unrecoverable = true;
  },
}));

const redisDisconnectMock = vi.fn();

vi.mock('ioredis', () => ({
  Redis: class {
    disconnect = redisDisconnectMock;
    on = vi.fn();
  },
}));

import { NonRetryableError, isNonRetryableError } from '../src/non-retryable.ts';
import { createBullMqQueue } from '../src/bullmq-queue.ts';
import { createQueueWorker } from '../src/worker.ts';

describe('投递参数（attempts／backoff）经 BullMQ 适配器落到作业参数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addMock.mockResolvedValue({ id: 7 });
  });

  it('不给投递参数时不传作业参数（保持既有调用形态）', async () => {
    const port = createBullMqQueue('ne.tasks', {});

    await port.enqueue('clue.verification', { runId: 'r-1' });

    expect(addMock).toHaveBeenCalledWith('clue.verification', { runId: 'r-1' });
  });

  it('总尝试次数与重试延迟策略按投递参数落到 BullMQ', async () => {
    const port = createBullMqQueue('ne.tasks', {});

    await port.enqueue('clue.verification', { runId: 'r-1' }, {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
    });

    expect(addMock).toHaveBeenCalledWith('clue.verification', { runId: 'r-1' }, {
      attempts: 4,
      backoff: { type: 'exponential', delay: 30_000 },
    });
  });

  it('手动重跑只跑一次：attempts 取 1', async () => {
    const port = createBullMqQueue('ne.tasks', {});

    await port.enqueue('clue.verification', { runId: 'r-2' }, { attempts: 1 });

    expect(addMock).toHaveBeenCalledWith('clue.verification', { runId: 'r-2' }, { attempts: 1 });
  });
});

describe('不可重试错误类型', () => {
  it('带失败类别，可判别', () => {
    const error = new NonRetryableError('missing-layers', '缺图层');

    expect(error.reason).toBe('missing-layers');
    expect(isNonRetryableError(error)).toBe(true);
    expect(isNonRetryableError(new Error('普通错误'))).toBe(false);
  });
});

describe('业务 worker 工厂', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  /** 起过 worker 之后取出 BullMQ 收到的处理器。 */
  function processorOf(): (job: { name: string; data: unknown; attemptsMade: number }) => Promise<unknown> {
    if (!capturedProcessor) throw new Error('worker 处理器未装配');
    return capturedProcessor;
  }

  it('处理器拿到载荷与第几次尝试（首次为 1）', async () => {
    const seen: { payload: unknown; attempt: number; jobName: string }[] = [];
    createQueueWorker({
      queueName: 'ne.tasks',
      redisUrl: 'redis://127.0.0.1:6379',
      processor: async (payload, context) => {
        seen.push({ payload, attempt: context.attempt, jobName: context.jobName });
        return 'ok';
      },
    });

    const result = await processorOf()({
      name: 'clue.verification',
      data: { runId: 'r-1' },
      attemptsMade: 0,
    });

    expect(result).toBe('ok');
    expect(seen).toEqual([
      { payload: { runId: 'r-1' }, attempt: 1, jobName: 'clue.verification' },
    ]);
  });

  it('不可重试错误翻译成队列的「不再重试」语义', async () => {
    createQueueWorker({
      queueName: 'ne.tasks',
      redisUrl: 'redis://127.0.0.1:6379',
      processor: async () => {
        throw new NonRetryableError('missing-layers', '缺图层');
      },
    });

    const failure = await processorOf()({
      name: 'clue.verification',
      data: {},
      attemptsMade: 0,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as { unrecoverable?: boolean }).unrecoverable).toBe(true);
  });

  it('其余错误原样抛出，交队列按投递参数决定是否重试', async () => {
    createQueueWorker({
      queueName: 'ne.tasks',
      redisUrl: 'redis://127.0.0.1:6379',
      processor: async () => {
        throw new Error('瞬时故障');
      },
    });

    const failure = await processorOf()({
      name: 'clue.verification',
      data: {},
      attemptsMade: 1,
    }).catch((error: unknown) => error);

    expect((failure as Error).message).toBe('瞬时故障');
    expect((failure as { unrecoverable?: boolean }).unrecoverable).toBeUndefined();
  });

  it('关闭时收掉 worker 与连接', async () => {
    workerCloseMock.mockResolvedValue(undefined);
    const handle = createQueueWorker({
      queueName: 'ne.tasks',
      redisUrl: 'redis://127.0.0.1:6379',
      processor: async () => 'ok',
    });

    await handle.close();

    expect(workerCloseMock).toHaveBeenCalledOnce();
    expect(redisDisconnectMock).toHaveBeenCalledOnce();
  });
});
