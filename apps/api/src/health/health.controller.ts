import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { HEALTH_ROUTES, HealthResultSchema, type HealthResult } from '@ne/contracts'
import { ApiContractResponse } from '../common/api-contract.decorator.js'

@ApiTags('health')
@Controller(HEALTH_ROUTES.base)
export class HealthController {
  @Get()
  @ApiContractResponse({
    status: 200,
    description: '服务健康状态',
    schema: HealthResultSchema,
  })
  health(): HealthResult {
    return { status: 'ok', uptime: Math.round(process.uptime()) }
  }
}
