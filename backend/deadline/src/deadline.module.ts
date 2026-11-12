// 用途：期限预警模块的 NestJS 模块声明。@Module({}) 不带提供者与控制器，期限计算以纯函数经 index.ts 导出。
// 调用方：backend/server/src/app.module.ts 装配本模块。
// 边界：期限的 HTTP 入口与落库在 backend/server/src/deadline.controller.ts、deadline.service.ts，不在本模块内。
// 依据：backend/README.md 依赖矩阵；docs/adr/0004-单一HTTP进程与同域入口.md。
import { Module } from '@nestjs/common';

/**
 * 期限预警模块（#51 空壳）。依赖矩阵行（#47，人读副本 backend/README.md）：
 * deadline → shield、case（订阅）、approval（订阅）、geo-dict（只读引用程序节点类型，#45 补丁 1）。
 * 往来形态：只读查询 + 事件，默认禁止直写；跨模块互引只许对方公共出口
 *（@natural-enforcement/<module> 根导入），由结构测试 module-public-entry 拦截。
 * #246 的计算与锚点经本模块公共出口给出。持久化由启动包经案件存储写入。
 */
@Module({})
export class DeadlineModule {}
