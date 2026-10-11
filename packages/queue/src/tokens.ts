// 队列接口注入令牌（#55）。令牌与抽象同层，保持本文件无装饰器
//（同包约定：装饰器只许出现在 queue.module.ts——探测进程以 node type-stripping 运行）。
export const QUEUE_PORT = Symbol('QUEUE_PORT');
