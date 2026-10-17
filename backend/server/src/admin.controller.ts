import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { AdminService } from './admin.service.ts';
import { sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface ResetBody {
  password?: unknown;
}

interface ExportBody {
  orgUnitId?: unknown;
}

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('locked-personnel')
  async list(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const actor = req.actor as ActorRef;
    const outcome = await this.admin.listLocked(actor);
    res.status(outcome.status).json(outcome.body);
  }

  /**
   * 人员导出（#125，ADR 0013）。导出要先写留痕，是写请求，走 POST，受框架内建的跨站防护（#91）。
   * 人员导出界面不在一期，后端保留。
   */
  @Post('personnel/export')
  async exportPersonnel(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: ExportBody,
  ): Promise<void> {
    const actor = req.actor as ActorRef;
    const orgUnitId = typeof body?.orgUnitId === 'string' ? body.orgUnitId : '';
    const outcome = await this.admin.exportPersonnel(actor, orgUnitId, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('personnel/:id/unlock')
  async unlock(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const actor = req.actor as ActorRef;
    const outcome = await this.admin.unlock(actor, id, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('personnel/:id/password-reset')
  async reset(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: ResetBody,
  ): Promise<void> {
    const actor = req.actor as ActorRef;
    const password = typeof body?.password === 'string' ? body.password : '';
    const outcome = await this.admin.resetPassword(actor, id, password, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }
}
