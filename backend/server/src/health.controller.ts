import { Controller, Get } from '@nestjs/common';

import { Public } from './public.decorator.ts';

/** GET /api/health 不读取、不要求会话。 */
@Controller('api')
export class HealthController {
  @Public()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
