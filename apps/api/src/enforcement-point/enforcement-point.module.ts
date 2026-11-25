import { Module } from '@nestjs/common'
import { EnforcementPointController } from './enforcement-point.controller.js'
import { EnforcementPointRepo } from './enforcement-point.repo.js'
import { EnforcementPointService } from './enforcement-point.service.js'

@Module({
  controllers: [EnforcementPointController],
  providers: [EnforcementPointRepo, EnforcementPointService],
})
export class EnforcementPointModule {}
