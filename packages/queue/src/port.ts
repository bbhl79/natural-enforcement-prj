// 用途：定义队列端口 QueuePort、任务引用 JobRef 与投递参数 EnqueueOptions，业务与设施代码只面向这组类型使用队列。
// 调用方：backend/server/src/clue-verification.service.ts（经 QUEUE_PORT 注入后投递任务）、backend/server/src/persistence.module.ts（提供 QUEUE_PORT）、packages/queue/src/bullmq-queue.ts（BullMQ 实现）。
// 队列抽象（QueuePort，#55）：业务与设施代码对队列的唯一面向。
// 可注入：经 QUEUE_PORT 令牌注入本接口（组合根手工装配），不面向 BullMQ 编程
//（BullMQ/ioredis 只许出现在本设施包内，结构测试 queue-facility-entry 机器兜底）。

/** 已投递任务的引用；消费确认只认 JobRef，不暴露 BullMQ Job 类型 */
export interface JobRef {
  id: string;
}

/**
 * 投递参数（可选）。不给即保持既有行为：任务只执行一次，不重试。
 *
 * attempts 是「总尝试次数」，含首次执行。取 4 即首次执行加至多 3 次自动重试。
 * backoff 是重试延迟策略：exponential 时延迟依次为 delay、delay×2、delay×4，
 * 故 delay 取 30000 即 30／60／120 秒三档。
 */
export interface EnqueueOptions {
  /** 总尝试次数（含首次执行）。 */
  readonly attempts?: number;
  /** 重试延迟策略。 */
  readonly backoff?: {
    readonly type: 'fixed' | 'exponential';
    /** 首次重试的延迟毫秒数（毫秒）。 */
    readonly delay: number;
  };
}

/**
 * 队列端口：投递任务、等待消费确认、关闭通道三个操作。
 * 实现：packages/queue/src/bullmq-queue.ts（BullMQ）；packages/queue/src/queue-port.ts 的 createQueuePort 返回惰性连接的包装实现。
 * 集成测试经 backend/server/src/persistence.module.ts 的 queuePort 覆写位换成内存假实现。
 */
export interface QueuePort {
  /** 投递任务（系统设施级；业务 worker 归各业务切片自带——G5） */
  enqueue(jobName: string, payload: unknown, options?: EnqueueOptions): Promise<JobRef>;
  /** 等待某任务消费完成并返回其结果；超时即拒绝（探测据此判红） */
  waitForCompletion(ref: JobRef, timeoutMs: number): Promise<unknown>;
  /** 关闭投递与确认通道（探测/进程退出前调用） */
  close(): Promise<void>;
}
