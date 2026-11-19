import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import {
  CreateEnforcementPointSchema,
  ENFORCEMENT_POINT_ROUTES,
  NearbyQuerySchema,
} from '@ne/contracts'
import type { CreateEnforcementPointDto, NearbyQueryDto } from '@ne/contracts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { EnforcementPointService } from './enforcement-point.service.js'

@ApiTags('enforcement-points')
@Controller(ENFORCEMENT_POINT_ROUTES.base)
export class EnforcementPointController {
  constructor(private readonly svc: EnforcementPointService) {}

  @Post()
  // 实测 #11：swagger 12.1.2 对裸 zod 与 z.toJSONSchema() 均不产 requestBody（SPEC 待解）；
  // 保留 z.toJSONSchema 形态占位，契约语义以 zod 管道为准
  @ApiBody({ schema: z.toJSONSchema(CreateEnforcementPointSchema) })
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
