import { Module } from '@nestjs/common'
import { HealthController } from './health/health.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { EnforcementPointModule } from './enforcement-point/enforcement-point.module.js'
// @gen:module-import

@Module({
  imports: [
    PrismaModule,
    EnforcementPointModule,
    // @gen:module-entry
  ],
  controllers: [HealthController],
})
export class AppModule {}
