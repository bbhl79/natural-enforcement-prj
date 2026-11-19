import { Module } from '@nestjs/common'
import { QueueModule } from '../queue/queue.module.js'
import { EvidenceController } from './evidence.controller.js'
import { EvidenceService } from './evidence.service.js'

@Module({
  imports: [QueueModule],
  controllers: [EvidenceController],
  providers: [EvidenceService],
})
export class EvidenceModule {}
