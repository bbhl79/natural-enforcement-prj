// 空间访问的最小执行器抽象（#54）：本模块只面向 $queryRaw 标签模板形态，
// 不引入 @prisma/client 依赖——数据库连接归属调用方（backend/prisma 生成的
// PrismaClient 结构兼容本接口；模块间往来只读查询的形态约束不被破坏）。
export interface SqlClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}
