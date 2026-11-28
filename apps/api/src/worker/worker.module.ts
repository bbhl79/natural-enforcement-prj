import { Module } from '@nestjs/common'
import { EvidenceRepo } from '../evidence/evidence.repo.js'
import { PrismaModule } from '../prisma/prisma.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { EvidenceWorkerService } from './evidence-worker.service.js'

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [EvidenceRepo, EvidenceWorkerService],
})
export class WorkerModule {}
