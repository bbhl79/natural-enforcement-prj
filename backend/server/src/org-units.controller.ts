// 用途：提供机构树查询与管理动作（新建、改名、停用）以及停用机构待分派池查询的 HTTP 接口，委托 OrgUnitsService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/org-units.service.ts（#123、#124、#216）。
//
import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueDispositionService } from './clue-disposition.service.ts';
import { OrgUnitsService } from './org-units.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import { sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface RegisterBody {
  parentId?: unknown;
  name?: unknown;
  level?: unknown;
}

interface RenameBody {
  name?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * 机构树（#123）。树查询放在 /api/org-units：管理台和业务侧（内勤选承办机构）复用同一接口。
 * 新建下级、改名与停用（#124）放在 /api/admin/org-units。
 * 跨站写请求由框架 CSRF 拒绝，跨站读请求由 SameOriginReadGuard 拒绝。
 */
@Controller('api')
export class OrgUnitsController {
  constructor(
    private readonly orgUnits: OrgUnitsService,
    private readonly disposition: ClueDispositionService,
  ) {}

  // 机构树查询，管理台与业务侧共用；操作码 org.tree.read；对象级以操作者现任机构为根返回子树。
  @Get('org-units')
  @UseGuards(SameOriginReadGuard)
  async tree(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.orgUnits.tree(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  // 新建机构；操作码 org.unit.register；对象级按父机构数据范围授权，parentId 缺省按数据范围拒绝。
  @Post('admin/org-units')
  async register(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: RegisterBody,
  ): Promise<void> {
    // parentId 缺省或为 null 视为新建根机构，一律按数据范围拒绝。
    const parentId = typeof body?.parentId === 'string' && body.parentId !== '' ? body.parentId : null;
    const outcome = await this.orgUnits.register(
      req.actor as ActorRef,
      { parentId, name: text(body?.name), level: text(body?.level) },
      sourceAddress(req),
    );
    res.status(outcome.status).json(outcome.body);
  }

  // 机构改名；操作码 org.unit.rename；对象级按目标机构数据范围授权。
  @Post('admin/org-units/:id/rename')
  async rename(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: RenameBody,
  ): Promise<void> {
    const outcome = await this.orgUnits.rename(req.actor as ActorRef, id, text(body?.name), sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  /** 停用（#124）。重复停用返回 200 unchanged。 */
  // 停用机构；操作码 org.unit.deactivate；对象级按目标机构数据范围授权。
  @Post('admin/org-units/:id/deactivate')
  async deactivate(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.orgUnits.deactivate(req.actor as ActorRef, id, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  /** 已停用机构待分派池的未派出线索清单（#216；只授系统管理，供重新指定接收机构）。 */
  // 列已停用机构待分派池的未派出线索；操作码 clue.pool.reassign；对象级限系统管理，目标机构须已停用。
  @Get('admin/org-units/:id/pool-clues')
  @UseGuards(SameOriginReadGuard)
  async poolClues(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.disposition.listPoolClues(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }
}
