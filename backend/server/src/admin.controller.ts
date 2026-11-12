// 用途：管理员管理人员的 HTTP 接口，含被锁人员列表、人员导出、解锁与重设初始口令。
// 调用方：前端管理界面；入口为 Nest 路由，控制器前缀 api/admin。
// 边界：只做请求解析与响应写回；授权、事务与留痕在 AdminService 与 PersonnelService。
// 依据：ADR 0013；ADR 0015；Issue #125。
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

/** 管理员人员管理接口的 HTTP 适配层：解析请求与来源地址，按服务结果写回状态码与响应体。 */
@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // 列出数据范围内被锁的人员；操作码 personnel.locked.read；对象级按操作者自身机构与数据范围过滤。
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
  // 操作码 personnel.profile.export；对象级按请求体给出的目标机构校验。
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

  // 解锁被锁人员并清除失败计数；操作码 personnel.locked.release；对象级按目标人员所属机构校验，且拒绝操作本人。
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

  // 重设初始口令并结束该人员全部会话与记住我；操作码 personnel.password.reset；对象级按目标人员所属机构校验，且拒绝操作本人。
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
