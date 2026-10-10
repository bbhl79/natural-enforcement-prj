// 队列抽象（QueuePort，#55）：业务与设施代码对队列的唯一面向。
// 可注入：经 QueueModule 的 QUEUE_PORT provider 注入本接口，不面向 BullMQ 编程
//（BullMQ/ioredis 只许出现在本设施包内，结构测试 queue-facility-entry 机器兜底）。

/** 已投递任务的引用；消费确认只认 JobRef，不暴露 BullMQ Job 类型 */
export interface JobRef {
  id: string;
}

export interface QueuePort {
  /** 投递任务（系统设施级；业务 worker 归各业务切片自带——G5） */
  enqueue(jobName: string, payload: unknown): Promise<JobRef>;
  /** 等待某任务消费完成并返回其结果；超时即拒绝（探测据此判红） */
  waitForCompletion(ref: JobRef, timeoutMs: number): Promise<unknown>;
  /** 关闭投递与确认通道（探测/进程退出前调用） */
  close(): Promise<void>;
}
