// 用途：提供管理台人员列表、卡片、登记、编辑、调岗与账号状态管理的 HTTP 接口，委托 PersonnelProfilesService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/personnel-profiles.service.ts、backend/identity/src/services/personnel-profile.service.ts（#128、#129、#130）。
//
import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { PersonnelProfilesService } from './personnel-profiles.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import { sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface RegisterBody {
  code?: unknown;
  name?: unknown;
  orgUnitId?: unknown;
  mobilePhone?: unknown;
  initialPassword?: unknown;
  roles?: unknown;
  posts?: unknown;
  certNo?: unknown;
  certExpiresOn?: unknown;
}

interface EditBody {
  name?: unknown;
  mobilePhone?: unknown;
  roles?: unknown;
  posts?: unknown;
}

interface TransferBody {
  orgUnitId?: unknown;
}

/** 恢复（#130）：新的初始口令必填；原任职机构已停用时另带新任职机构。 */
interface RestoreBody {
  initialPassword?: unknown;
  orgUnitId?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] =>
  (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : []);

/**
 * 管理台人员（#128）：列表、卡片、登记。编辑与调岗（#129）。停用、恢复与结束全部会话（#130）。
 * 跨站写请求由框架 CSRF 拒绝，跨站读请求由 SameOriginReadGuard 拒绝。
 */
@Controller('api/admin')
export class PersonnelController {
  constructor(private readonly personnel: PersonnelProfilesService) {}

  // 人员列表；操作码 personnel.profile.read；对象级以操作者现任机构为根返回子树。
  @Get('personnel')
  @UseGuards(SameOriginReadGuard)
  async list(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.personnel.list(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  // 人员卡片；操作码 personnel.profile.read；对象级按对方当前任职机构授权。
  @Get('personnel/:id')
  @UseGuards(SameOriginReadGuard)
  async card(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.personnel.card(req.actor as ActorRef, id, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  // 人员登记；操作码 personnel.profile.register；对象级按目标任职机构授权。
  @Post('personnel')
  async register(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: RegisterBody,
  ): Promise<void> {
    const outcome = await this.personnel.register(
      req.actor as ActorRef,
      {
        code: text(body?.code),
        name: text(body?.name),
        orgUnitId: text(body?.orgUnitId),
        mobilePhone: text(body?.mobilePhone),
        initialPassword: text(body?.initialPassword),
        roles: texts(body?.roles),
        posts: texts(body?.posts),
        certNo: text(body?.certNo),
        certExpiresOn: text(body?.certExpiresOn),
      },
      sourceAddress(req),
    );
    res.status(outcome.status).json(outcome.body);
  }

  /** 编辑（#129）：姓名、手机号、角色、岗位标记。什么都没改也是 200，不写留痕。 */
  // 编辑人员资料；操作码 personnel.profile.update；对象级按对方当前任职机构授权。
  @Post('personnel/:id/edit')
  async edit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: EditBody,
  ): Promise<void> {
    const outcome = await this.personnel.edit(
      req.actor as ActorRef,
      id,
      {
        name: text(body?.name),
        mobilePhone: text(body?.mobilePhone),
        roles: texts(body?.roles),
        posts: texts(body?.posts),
      },
      sourceAddress(req),
    );
    res.status(outcome.status).json(outcome.body);
  }

  /** 调岗（#129）：目的地不限数据范围，但必须是未停用机构。 */
  // 调岗；操作码 personnel.profile.update；对象级按对方当前任职机构与调岗目标机构授权。
  @Post('personnel/:id/transfer')
  async transfer(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: TransferBody,
  ): Promise<void> {
    const outcome = await this.personnel.transfer(req.actor as ActorRef, id, text(body?.orgUnitId), sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  /** 调岗目的地清单（#129）：全树未停用的机构。读取不写留痕。 */
  // 调岗目的地清单；操作码 personnel.profile.update；对象级按对方当前任职机构授权。
  @Get('personnel/:id/transfer-destinations')
  @UseGuards(SameOriginReadGuard)
  async transferDestinations(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.personnel.transferDestinations(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  /** 停用（#130）：对方的全部会话在下一次请求时结束。重复停用返回 200，不写行。 */
  // 停用人员；操作码 personnel.profile.deactivate；对象级按对方当前任职机构授权。
  @Post('personnel/:id/deactivate')
  async deactivate(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.personnel.deactivate(req.actor as ActorRef, id, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  /**
   * 恢复（#130）：重设初始口令、解除锁定、结束残余会话和「记住我」同事务。
   * 原任职机构已停用时必须带新任职机构（orgUnitId），恢复与调岗一并完成。
   */
  // 恢复人员；操作码 personnel.profile.restore；对象级按对方当前任职机构授权，另带新任职机构时再按目的地校验。
  @Post('personnel/:id/restore')
  async restore(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: RestoreBody,
  ): Promise<void> {
    const outcome = await this.personnel.restore(
      req.actor as ActorRef,
      id,
      { initialPassword: text(body?.initialPassword), orgUnitId: text(body?.orgUnitId) },
      sourceAddress(req),
    );
    res.status(outcome.status).json(outcome.body);
  }

  /** 结束全部会话（#130）：每段写 session.ended，另写一行 personnel.sessions-ended，不改口令。 */
  // 结束全部会话；操作码 personnel.sessions.end；对象级按对方当前任职机构授权。
  @Post('personnel/:id/end-sessions')
  async endSessions(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
  ): Promise<void> {
    const outcome = await this.personnel.endSessions(req.actor as ActorRef, id, sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }
}
