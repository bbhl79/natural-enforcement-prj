import { Module } from '@nestjs/common'
import { HealthController } from './health/health.controller.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { StorageModule } from './storage/storage.module.js'
import { QueueModule } from './queue/queue.module.js'
import { EnforcementPointModule } from './enforcement-point/enforcement-point.module.js'
import { EvidenceModule } from './evidence/evidence.module.js'

@Module({
  imports: [PrismaModule, StorageModule, QueueModule, EnforcementPointModule, EvidenceModule],
  controllers: [HealthController],
})
export class AppModule {}
