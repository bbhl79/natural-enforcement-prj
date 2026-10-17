import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ApprovalModule } from '@natural-enforcement/approval';
import { CaseModule } from '@natural-enforcement/case';
import { DeadlineModule } from '@natural-enforcement/deadline';
import { GeoDictModule } from '@natural-enforcement/geo-dict';
import { IdentityModule } from '@natural-enforcement/identity';
import { SupervisionModule } from '@natural-enforcement/supervision';

import { AdminController } from './admin.controller.ts';
import { AdminService } from './admin.service.ts';
import { AuthController } from './auth.controller.ts';
import { AuthService } from './auth.service.ts';
import { HealthController } from './health.controller.ts';
import { SessionGuard } from './session.guard.ts';
import { SourceGate } from './source-gate.ts';

/** 启动包装入六个业务模块。它本身不是第七个业务模块。 */
@Module({
  imports: [
    IdentityModule,
    CaseModule,
    ApprovalModule,
    SupervisionModule,
    DeadlineModule,
    GeoDictModule,
  ],
  controllers: [HealthController, AuthController, AdminController],
  providers: [AuthService, AdminService, SourceGate, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AppModule {}
