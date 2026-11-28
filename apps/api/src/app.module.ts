import { Module } from '@nestjs/common'
import { HealthController } from './health/health.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { EnforcementPointModule } from './enforcement-point/enforcement-point.module.js'
import { EvidenceModule } from './evidence/evidence.module.js'
// @gen:module-import

@Module({
  imports: [
    PrismaModule,
    EnforcementPointModule,
    EvidenceModule,
    // @gen:module-entry
  ],
  controllers: [HealthController],
})
export class AppModule {}
