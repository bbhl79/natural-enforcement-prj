import { Module } from '@nestjs/common';

/**
 * 空间字典模块：持有合规规则参考数据，不依赖任何业务模块。
 * 参照数据的承载方式见 ADR 0016（docs/adr/0016-参照数据随种子只追加写入.md，#78）。
 * 依赖矩阵行（#47，人读副本 backend/README.md）：geo-dict 不依赖任何业务模块。
 * 往来形态：只读查询 + 事件，默认禁止直写；跨模块互引只许对方公共出口
 *（@natural-enforcement/<module> 根导入），由结构测试 module-public-entry 拦截。
 * 本切片无业务实体（G1），@Module 元数据随真实调用方逐切片填充。
 */
@Module({})
export class GeoDictModule {}
