// 用途：监督统计模块的 NestJS 模块声明。当前是空壳，没有提供者与控制器，尚未交付业务能力。
// 调用方：backend/server/src/app.module.ts 装配本模块。
// 依据：backend/README.md 依赖矩阵；docs/adr/0004-单一HTTP进程与同域入口.md。
import { Module } from '@nestjs/common';

/**
 * 监督统计模块（#51 空壳）。依赖矩阵行（#47，人读副本 backend/README.md）：
 * supervision → shield、identity、case（只读，单向，无人依赖它）。
 * 往来形态：只读查询 + 事件，默认禁止直写；跨模块互引只许对方公共出口
 *（@natural-enforcement/<module> 根导入），由结构测试 module-public-entry 拦截。
 * 本切片无业务实体（G1），@Module 元数据随真实调用方逐切片填充。
 */
@Module({})
export class SupervisionModule {}
