// 用途：其他方式登记、结案提醒处理、不派视图与界面选项的 HTTP 接口。
// 其他（#229）登记与结案提醒接口（#217／#226／#229；规格 D 节）。
//
// POST /api/clues/:id/disposition          其他登记（#229）；disposition=no-case 一律拒绝（#226）
// GET  /api/clues/reminders                结案提醒列表（未处理）
// POST /api/clues/reminders/:id/resolve    提醒处理（二选一：撤回不派再办｜写明原因随旧线索办结）
// GET  /api/clues/held                     不派视图（可撤回不派的线索）
//
// 状态写动作带 expectedStatus，冲突 409 concurrent-change；失败留痕、业务行不变。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueClosureService } from './clue-closure.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface DispositionBody {
  readonly disposition?: unknown;
  readonly note?: unknown;
  readonly expectedStatus?: unknown;
}

interface ResolveBody {
  readonly resolution?: unknown;
  readonly reasonCodes?: unknown;
  readonly note?: unknown;
  readonly expectedStatus?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : [];

/** 其他登记与结案提醒接口的 HTTP 适配层。 */
@Controller('api/clues')
export class ClueClosureController {
  constructor(private readonly closure: ClueClosureService) {}

  /** 其他（#229）登记；disposition=no-case 拒绝（#226）。 */
  // 操作码 clue.disposition.record；对象级须为主办／协办本人或承办机构内勤。
  @Post(':id/disposition')
  async recordNoCase(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: DispositionBody,
  ): Promise<void> {
    const outcome = await this.closure.recordNoCase(req.actor as ActorRef, id, {
      disposition: text(body?.disposition),
      note: text(body?.note),
      expectedStatus: text(body?.expectedStatus),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 结案提醒列表。 */
  // 操作码 clue.read；对象级按操作者所属机构校验。
  @Get('reminders')
  @UseGuards(SameOriginReadGuard)
  async listReminders(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.closure.listReminders(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }

  /** 提醒处理：撤回不派再办｜写明原因随旧线索办结。 */
  // 操作码 clue.reminder.resolve；对象级须为录入人、录入机构内勤或所撞旧线索承办机构内勤。
  @Post('reminders/:id/resolve')
  async resolveReminder(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: ResolveBody,
  ): Promise<void> {
    const outcome = await this.closure.resolveReminder(req.actor as ActorRef, id, {
      resolution: text(body?.resolution),
      reasonCodes: texts(body?.reasonCodes),
      note: text(body?.note),
      expectedStatus: text(body?.expectedStatus),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 撤回不派与结案提醒的界面口径（四项常用原因）。 */
  // 无操作码（服务只返回静态原因选项，不做授权）。
  @Get('closure-options')
  @UseGuards(SameOriginReadGuard)
  async options(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.closure.readOptions();
    res.status(outcome.status).json(outcome.body);
  }

  /** 不派视图。 */
  // 操作码 clue.read；对象级按操作者所属机构校验。
  @Get('held')
  @UseGuards(SameOriginReadGuard)
  async listHeld(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.closure.listHeld(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }
}
