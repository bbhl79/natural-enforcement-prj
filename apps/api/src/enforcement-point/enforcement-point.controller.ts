import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiBody, ApiTags } from '@nestjs/swagger'
import type { SchemaObject } from '@nestjs/swagger'
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
  // 保留 z.toJSONSchema 形态占位，契约语义以 zod 管道为准。
  // #12 实测：@nestjs/common 12.6.0 的 SchemaObject 类型收紧（lockgen 重解析把 ^12.5.1 漂到 12.6.0，
  // 坑记录 NOTES-slice2 §5）——占位处显式 as 断言，语义不变
  @ApiBody({ schema: z.toJSONSchema(CreateEnforcementPointSchema) as SchemaObject })
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
