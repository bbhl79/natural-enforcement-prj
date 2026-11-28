import { Module } from '@nestjs/common'
import { QueueModule } from '../queue/queue.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { EvidenceController } from './evidence.controller.js'
import { EvidenceRepo } from './evidence.repo.js'
import { EvidenceService } from './evidence.service.js'

@Module({
  imports: [QueueModule, StorageModule],
  controllers: [EvidenceController],
  providers: [EvidenceRepo, EvidenceService],
})
export class EvidenceModule {}