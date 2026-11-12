// 用途：提供报请指定管辖的发起、驳回与受理人待办三个 HTTP 接口，解析请求后委托 ClueDesignationService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/clue-designation.service.ts（#215；规格 D/H 节）。
//
// 报请指定管辖接口（#215；规格 D/H 节）。
//
// POST /api/clues/:id/designate-request  发起报请（本级机构内勤；理由必填、可选拟归属机构）
// POST /api/clues/:id/designate-reject   驳回报请（受理人；理由必填）
// GET  /api/clues/designation-requests   受理人待办（待处理报请里受理机构为本人机构的）
//
// 写请求一律 POST（框架 CSRF）；读请求挂 SameOriginReadGuard。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueDesignationService } from './clue-designation.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface DesignateRequestBody {
  readonly reason?: unknown;
  readonly proposedOrgId?: unknown;
}

interface DesignateRejectBody {
  readonly reason?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// 报请指定管辖的 HTTP 入口，请求处理全部委托 ClueDesignationService。
@Controller('api/clues')
export class ClueDesignationController {
  constructor(private readonly designation: ClueDesignationService) {}

  /** 受理人待办：待处理的指定管辖报请。 */
  // 列出受理机构为本人机构的待处理报请；操作码 clue.designate.request；对象级限本人所属机构。
  @Get('designation-requests')
  @UseGuards(SameOriginReadGuard)
  async todos(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.designation.listPendingTodos(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  /** 发起报请指定管辖。 */
  // 发起报请指定管辖；操作码 clue.designate.request；对象级限线索当前所属机构的内勤。
  @Post(':id/designate-request')
  async request(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: DesignateRequestBody,
  ): Promise<void> {
    const outcome = await this.designation.request(req.actor as ActorRef, id, {
      reason: text(body?.reason),
      proposedOrgId: text(body?.proposedOrgId) === '' ? null : text(body?.proposedOrgId),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 驳回报请。 */
  // 驳回报请；操作码 clue.designate.request；对象级限报请受理机构的内勤。
  @Post(':id/designate-reject')
  async reject(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: DesignateRejectBody,
  ): Promise<void> {
    const outcome = await this.designation.reject(req.actor as ActorRef, id, {
      reason: text(body?.reason),
    });
    res.status(outcome.status).json(outcome.body);
  }
}
