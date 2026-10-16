import { Module } from '@nestjs/common';

import { ApprovalModule } from '@natural-enforcement/approval';
import { CaseModule } from '@natural-enforcement/case';
import { DeadlineModule } from '@natural-enforcement/deadline';
import { GeoDictModule } from '@natural-enforcement/geo-dict';
import { IdentityModule } from '@natural-enforcement/identity';
import { SupervisionModule } from '@natural-enforcement/supervision';

import { HealthController } from './health.controller.ts';
import { IdentityStoreModule } from './identity-store.module.ts';

/** 启动包装入六个业务模块。它本身不是第七个业务模块。 */
@Module({
  imports: [
    IdentityStoreModule,
    IdentityModule,
    CaseModule,
    ApprovalModule,
    SupervisionModule,
    DeadlineModule,
    GeoDictModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
