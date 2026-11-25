import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import {
  CreateEnforcementPointSchema,
  ENFORCEMENT_POINT_ROUTES,
  NearbyQuerySchema,
} from '@ne/contracts'
import type {
  CreateEnforcementPointDto,
  CreateEnforcementPointResult,
  NearbyQueryDto,
  NearbyResult,
} from '@ne/contracts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { EnforcementPointService } from './enforcement-point.service.js'

// 路由常量来自契约包（前后端同一真相）；请求经 zod 管道运行时校验。
@Controller(ENFORCEMENT_POINT_ROUTES.base)
export class EnforcementPointController {
  constructor(private readonly svc: EnforcementPointService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateEnforcementPointSchema)) dto: CreateEnforcementPointDto,
  ): Promise<CreateEnforcementPointResult> {
    return this.svc.create(dto)
  }

  // 路径常量见 ENFORCEMENT_POINT_ROUTES.nearby（'/enforcement-points/nearby'）
  @Get('nearby')
  async nearby(
    @Query(new ZodValidationPipe(NearbyQuerySchema)) q: NearbyQueryDto,
  ): Promise<NearbyResult> {
    return this.svc.nearby(q)
  }
}
