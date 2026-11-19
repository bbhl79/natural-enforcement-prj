import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  CreateEnforcementPointDto,
  CreateEnforcementPointSchema,
  ENFORCEMENT_POINT_ROUTES,
  NearbyQueryDto,
  NearbyQuerySchema,
} from '@ne/contracts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { EnforcementPointService } from './enforcement-point.service.js'

@ApiTags('enforcement-points')
@Controller(ENFORCEMENT_POINT_ROUTES.base)
export class EnforcementPointController {
  constructor(@Inject(EnforcementPointService) private readonly svc: EnforcementPointService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateEnforcementPointSchema)) dto: CreateEnforcementPointDto,
  ): Promise<{ id: number }> {
    return this.svc.create(dto)
  }

  // 路径常量见 ENFORCEMENT_POINT_ROUTES.nearby（'/enforcement-points/nearby'）
  @Get('nearby')
  async nearby(
    @Query(new ZodValidationPipe(NearbyQuerySchema)) q: NearbyQueryDto,
  ) {
    return this.svc.nearby(q)
  }
}
