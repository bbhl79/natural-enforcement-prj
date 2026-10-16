import { Controller, Get } from '@nestjs/common';

/** GET /api/health 不读取、不要求会话。 */
@Controller('api')
export class HealthController {
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
