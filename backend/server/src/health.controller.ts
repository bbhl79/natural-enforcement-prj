// 用途：提供健康检查 HTTP 接口，返回固定 ok 状态，不读取会话与存储。
// 调用方：backend/server/src/app.module.ts 注册为控制器；健康探针调用 GET /api/health。
import { Controller, Get } from '@nestjs/common';

import { Public } from './public.decorator.ts';

/** GET /api/health 不读取、不要求会话。 */
@Controller('api')
export class HealthController {
  @Public()
  // 健康检查；无操作码（公开接口，不要求会话）。
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
