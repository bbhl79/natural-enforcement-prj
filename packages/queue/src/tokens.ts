// 用途：定义队列端口的依赖注入令牌 QUEUE_PORT 与队列名令牌 QUEUE_NAME。
// 调用方：QUEUE_PORT 由 backend/server/src/persistence.module.ts 提供，由 backend/server/src/clue-verification.service.ts 注入；QUEUE_NAME 当前无外部调用方。
// 队列接口注入令牌（#55）。令牌与抽象同层，保持本文件无装饰器
//（同包约定：装饰器只许出现在 queue.module.ts——探测进程以 node type-stripping 运行）。
export const QUEUE_PORT = Symbol('QUEUE_PORT');

/** 队列名令牌（#213）：同进程的投递端与消费端取同一个队列名。 */
export const QUEUE_NAME = Symbol('QUEUE_NAME');
