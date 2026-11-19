import { Module } from '@nestjs/common'
import { EvidenceQueueService } from './evidence-queue.service.js'

@Module({
  providers: [EvidenceQueueService],
  exports: [EvidenceQueueService],
})
export class QueueModule {}
