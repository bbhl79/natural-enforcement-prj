// 存储接口注入令牌（#53）。令牌与抽象同层，保持本文件无装饰器
//（同包约定：装饰器只许出现在 storage.module.ts——E3 驱动与探测进程
// 以 node type-stripping 运行，其传递闭包内任何文件出现装饰器语法即运行失败）。
export const STORAGE_PORT = Symbol('STORAGE_PORT');
