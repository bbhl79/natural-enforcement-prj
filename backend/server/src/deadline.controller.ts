// 用途：提供案件期限视图、期限基准、延长、期间事件、期限呈批与工作日历安装的 HTTP 接口，委托 DeadlineService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/deadline.service.ts（#246）。
//
// 期限的 HTTP 入口（#246）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { DeadlineService } from './deadline.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

// 期限相关接口的 HTTP 入口，请求处理全部委托 DeadlineService。
@Controller()
export class DeadlineController {
  constructor(private readonly deadlines: DeadlineService) {}

  // 读取案件的期限视图；操作码 case.read；对象级按案件承办机构授权。
  @Get('api/cases/:id/deadlines')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.deadlines.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 保存期限起算基准；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/deadline-anchors')
  @UseGuards(SameOriginReadGuard)
  async saveAnchor(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly ruleKey?: unknown;
      readonly entrySeq?: unknown;
      readonly procedureNode?: unknown;
      readonly startingDocument?: unknown;
      readonly startedOn?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.deadlines.saveAnchor(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 保存期限延长；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/deadline-extensions')
  @UseGuards(SameOriginReadGuard)
  async saveExtension(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly days?: unknown; readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.deadlines.saveExtension(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 录入系统期间事件；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/period-events/system')
  @UseGuards(SameOriginReadGuard)
  async saveSystemPeriod(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly eventKind?: unknown;
      readonly basisLabel?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.deadlines.saveSystemPeriod(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 录入期间事件；操作码 doc.draft；对象级须本案主办或协办。
  @Post('api/cases/:id/period-events')
  @UseGuards(SameOriginReadGuard)
  async savePeriod(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly eventKind?: unknown;
      readonly reason?: unknown;
      readonly basisLabel?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
      readonly backfill?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.deadlines.savePeriod(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  // 提交期限呈批；操作码 doc.submit；对象级须本案主办或协办。
  @Post('api/deadline-approvals/:id/submit')
  @UseGuards(SameOriginReadGuard)
  async submit(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.deadlines.submit(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  // 审核期限呈批；操作码 doc.admin.review；名册层按角色授权，无额外对象级要求。
  @Post('api/deadline-approvals/:id/review')
  @UseGuards(SameOriginReadGuard)
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.deadlines.review(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 批准期限呈批；操作码 doc.approve；名册层按角色授权，无额外对象级要求。
  @Post('api/deadline-approvals/:id/approve')
  @UseGuards(SameOriginReadGuard)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.deadlines.approve(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  // 安装工作日历；操作码 doc.approve；对象级按操作者所属机构授权。
  @Post('api/deadline/calendar-installs')
  @UseGuards(SameOriginReadGuard)
  async installCalendar(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Body() body: {
      readonly version?: unknown;
      readonly year?: unknown;
      readonly holidays?: unknown;
      readonly makeupWorkdays?: unknown;
      readonly sourceUrl?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.deadlines.installCalendar(req.actor as ActorRef, body);
    res.status(outcome.status).json(outcome.body);
  }
}
