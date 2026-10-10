import { Module } from '@nestjs/common';

import { AccessControlService } from './services/access-control.service.ts';
import { CredentialService } from './services/credential.service.ts';
import { OrgUnitService } from './services/org-unit.service.ts';
import { PersonnelService } from './services/personnel.service.ts';

/**
 * 身份组织模块（#52 落地：人员/机构只失效不删除、名称版本化、读/改/导出/审批
 * 四类动作强校验、导出留痕 append-only）。依赖矩阵行（#47，人读副本 backend/README.md）：
 * identity 不依赖任何业务模块（shield 为统一契约，矩阵允许）。
 * 往来形态：只读查询 + 事件，默认禁止直写；跨模块互引只许对方公共出口
 *（@natural-enforcement/<module> 根导入），由结构测试 module-public-entry 拦截。
 *
 * 持久化：服务经 IDENTITY_STORE 令牌注入 IdentityStore 端口，本模块不提供 store
 * 实现绑定（深度纪律：第一个真实调用方驱动）——integration/e2-access-matrix.test.ts
 * 以 PrismaIdentityStore 装配；未来 API 层接管绑定时本元数据无需改动。
 */
@Module({
  providers: [
    AccessControlService,
    CredentialService,
    OrgUnitService,
    PersonnelService,
  ],
  exports: [
    AccessControlService,
    CredentialService,
    OrgUnitService,
    PersonnelService,
  ],
})
export class IdentityModule {}
