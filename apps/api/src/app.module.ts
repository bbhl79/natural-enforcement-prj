import { Module } from '@nestjs/common'
import { HealthController } from './health/health.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { EnforcementPointModule } from './enforcement-point/enforcement-point.module.js'

@Module({
  imports: [PrismaModule, EnforcementPointModule],
  controllers: [HealthController],
})
export class AppModule {}
