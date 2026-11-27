import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiBadRequestResponse, ApiConflictResponse, ApiTags } from '@nestjs/swagger'
import {
  ConflictErrorSchema,
  CreateEnforcementPointResultSchema,
  CreateEnforcementPointSchema,
  ENFORCEMENT_POINT_ROUTES,
  NearbyQuerySchema,
  NearbyResultSchema,
  ValidationErrorSchema,
} from '@ne/contracts'
import type {
  CreateEnforcementPointDto,
  CreateEnforcementPointResult,
  NearbyQueryDto,
  NearbyResult,
} from '@ne/contracts'
import { ApiContractResponse } from '../common/api-contract.decorator.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { EnforcementPointService } from './enforcement-point.service.js'

const zodPipe = new ZodValidationPipe()

// 路由常量与请求/响应 schema 全部来自契约包（zod 唯一事实源）：
// - 请求侧：@Body/@Query({ schema, pipes }) 同时驱动运行时 zod 校验与 OpenAPI 3.0 派生；
// - 响应侧：@ApiContractResponse 同时驱动运行时 StandardSchemaSerializerInterceptor 与 OpenAPI 响应派生。
@ApiTags('enforcement-points')
@Controller(ENFORCEMENT_POINT_ROUTES.base)
export class EnforcementPointController {
  constructor(private readonly svc: EnforcementPointService) {}

  @Post()
  @ApiContractResponse({
    status: 201,
    description: '创建执法点位成功',
    schema: CreateEnforcementPointResultSchema,
  })
  @ApiBadRequestResponse({
    description: '请求体契约校验失败',
    standardSchema: ValidationErrorSchema,
  })
  @ApiConflictResponse({
    description: '执法点位名称已存在',
    standardSchema: ConflictErrorSchema,
  })
  async create(
    @Body({ schema: CreateEnforcementPointSchema, pipes: [zodPipe] })
    dto: CreateEnforcementPointDto,
  ): Promise<CreateEnforcementPointResult> {
    return this.svc.create(dto)
  }

  // 路径常量见 ENFORCEMENT_POINT_ROUTES.nearby（'/enforcement-points/nearby'）
  @Get('nearby')
  @ApiContractResponse({
    status: 200,
    description: '附近执法点位列表',
    schema: NearbyResultSchema,
  })
  @ApiBadRequestResponse({
    description: '查询参数契约校验失败',
    standardSchema: ValidationErrorSchema,
  })
  async nearby(
    @Query({ schema: NearbyQuerySchema, pipes: [zodPipe] }) q: NearbyQueryDto,
  ): Promise<NearbyResult> {
    return this.svc.nearby(q)
  }
}
