import { Controller, Get } from '@nestjs/common'
import { HEALTH_ROUTES, type HealthResult } from '@ne/contracts'

@Controller(HEALTH_ROUTES.base)
export class HealthController {
  @Get()
  health(): HealthResult {
    return { status: 'ok', uptime: Math.round(process.uptime()) }
  }
}
