// 用途：声明空间存取与辖区读取函数所需的最小 SQL 执行器接口，使本模块不依赖 @prisma/client。
// 调用方：backend/geo-dict/src/spatial 下的几何存取与坐标换算函数，以及 backend/geo-dict/src/reference-data/jurisdiction-lookup.ts。
//   实参由外部提供：backend/server/src/persistence.module.ts 与 integration/e4-coordinate-roundtrip.test.ts 传入 PrismaClient。
// 空间访问的最小执行器抽象（#54）：本模块只面向 $queryRaw 标签模板形态，
// 不引入 @prisma/client 依赖——数据库连接归属调用方（backend/prisma 生成的
// PrismaClient 结构兼容本接口；模块间往来只读查询的形态约束不被破坏）。
export interface SqlClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}
