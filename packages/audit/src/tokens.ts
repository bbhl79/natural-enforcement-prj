// 用途：留痕设施包的两个依赖注入令牌：写入端口令牌，以及按事务客户端取写入接口的工厂令牌。
// 调用方：backend/server/src/persistence.module.ts 绑定并导出两个令牌；backend/identity/src/services/access-control.service.ts 与 backend/server/src/auth.service.ts 注入写入端口令牌。
// 边界：工厂令牌当前只在 persistence.module.ts 绑定，没有 @Inject 注入点（同文件的 PrismaUnitOfWork 直接收工厂实例）。
// 依据：docs/adr/0012-留痕写入经独立设施包.md。

/** 留痕写入注入令牌（ADR 0012）。业务侧只许经此令牌追加，不得碰留痕表。 */
export const AUDIT_TRAIL_PORT = Symbol('AUDIT_TRAIL_PORT');

/** 留痕工厂注入令牌（#119 接缝①）。按事务客户端取得写入接口，测试可覆写。 */
export const AUDIT_TRAIL_FACTORY = Symbol('AUDIT_TRAIL_FACTORY');
