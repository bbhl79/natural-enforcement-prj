// 证据队列的运行时配置（API 生产者 / worker / healthcheck 共用；不引入 Nest/BullMQ）。
export const DEFAULT_EVIDENCE_QUEUE_NAME = 'evidence-processing'

/** 队列名支持注入（#70 每 run 独立键空间的前置能力） */
export function evidenceQueueName(): string {
  const configured = process.env.EVIDENCE_QUEUE_NAME?.trim()
  return configured && configured.length > 0 ? configured : DEFAULT_EVIDENCE_QUEUE_NAME
}

export function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://redis:6379'
}

/** worker 心跳键（compose healthcheck 以它判定 worker 是否真正在消费循环中） */
export function workerHeartbeatKey(queueName: string): string {
  return `ne:evidence-worker:${queueName}:heartbeat`
}

export const WORKER_HEARTBEAT_TTL_SECONDS = 30
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000

/** 浏览器可见的失败原因：不含内部地址/异常细节（完整异常只进服务端日志） */
export const EVIDENCE_PROCESSING_FAILED_MESSAGE = '证据处理失败：无法读取或校验对象'