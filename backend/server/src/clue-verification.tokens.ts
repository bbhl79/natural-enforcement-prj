// 内业核查在启动包里的注入令牌与队列名（#213）。
// 本文件无装饰器（令牌与抽象同层的约定）。

/** 是否起核查 worker（接缝：测试与生产分开）。 */
export const VERIFICATION_WORKER_ENABLED = Symbol('VERIFICATION_WORKER_ENABLED');

/**
 * 业务任务队列名。投递端与消费端取同一个名字。
 * 业务 worker 归业务切片自带，任务名不占 system. 命名空间。
 */
export const CLUE_VERIFICATION_QUEUE_NAME = 'ne.clue.verification';
