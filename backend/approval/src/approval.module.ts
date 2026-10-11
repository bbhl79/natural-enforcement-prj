import { Module } from '@nestjs/common';

/**
 * 审批协同模块（#51 空壳）。依赖矩阵行（#47，人读副本 backend/README.md）：
 * approval → shield、identity、case（只读引用 + 订阅事件）。
 * 往来形态：只读查询 + 事件，默认禁止直写；跨模块互引只许对方公共出口
 *（@natural-enforcement/<module> 根导入），由结构测试 module-public-entry 拦截。
 * 本切片无业务实体（G1），@Module 元数据随真实调用方逐切片填充。
 */
@Module({})
export class ApprovalModule {}
