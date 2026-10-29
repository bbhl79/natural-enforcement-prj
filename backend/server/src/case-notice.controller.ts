// 告知、陈述申辩与听证的 HTTP 入口（#272）。
// 告知呈批走 doc.*；听证事务复用行政审核的 case.review.record（过渡，待 #230 回写 #71）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { readConfirmation } from './case-rule-confirmation.ts';
import { CaseNoticeService } from './case-notice.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseNoticeController {
  constructor(private readonly notices: CaseNoticeService) {}

  @Get('api/cases/:id/notice')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.notices.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/notices')
  @UseGuards(SameOriginReadGuard)
  async save(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly content?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.saveNotice(req.actor as ActorRef, id, { content: body.content });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/notices/:noticeId/submit')
  @UseGuards(SameOriginReadGuard)
  async submit(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('noticeId') noticeId: string,
  ): Promise<void> {
    const outcome = await this.notices.submitNotice(req.actor as ActorRef, noticeId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/notices/:noticeId/review')
  @UseGuards(SameOriginReadGuard)
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('noticeId') noticeId: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.reviewNotice(req.actor as ActorRef, noticeId, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/notices/:noticeId/approve')
  @UseGuards(SameOriginReadGuard)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('noticeId') noticeId: string,
    @Body() body: {
      readonly opinion?: unknown;
      readonly confirmedRuleKeys?: unknown;
      readonly confirmReasons?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.notices.approveNotice(req.actor as ActorRef, noticeId, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
      ...readConfirmation(body),
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/notices/:noticeId/serve')
  @UseGuards(SameOriginReadGuard)
  async serve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('noticeId') noticeId: string,
  ): Promise<void> {
    const outcome = await this.notices.serveNotice(req.actor as ActorRef, noticeId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/statements')
  @UseGuards(SameOriginReadGuard)
  async statement(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.recordStatement(req.actor as ActorRef, id, { note: body.note });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/notice-completions')
  @UseGuards(SameOriginReadGuard)
  async complete(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly basis?: unknown; readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.completeNotice(req.actor as ActorRef, id, {
      basis: body.basis,
      note: body.note,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/hearing-requests')
  @UseGuards(SameOriginReadGuard)
  async requestHearing(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.requestHearing(req.actor as ActorRef, id, { note: body.note });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/hearings/:hearingId/accept')
  @UseGuards(SameOriginReadGuard)
  async accept(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('hearingId') hearingId: string,
  ): Promise<void> {
    const outcome = await this.notices.acceptHearing(req.actor as ActorRef, hearingId);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/hearings/:hearingId/schedule')
  @UseGuards(SameOriginReadGuard)
  async schedule(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('hearingId') hearingId: string,
    @Body() body: { readonly scheduledFor?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.scheduleHearing(req.actor as ActorRef, hearingId, {
      scheduledFor: body.scheduledFor,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/hearings/:hearingId/host')
  @UseGuards(SameOriginReadGuard)
  async host(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('hearingId') hearingId: string,
    @Body() body: { readonly personnelId?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.designateHost(req.actor as ActorRef, hearingId, {
      personnelId: body.personnelId,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/hearings/:hearingId/end')
  @UseGuards(SameOriginReadGuard)
  async end(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('hearingId') hearingId: string,
    @Body() body: { readonly endKind?: unknown; readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.endHearing(req.actor as ActorRef, hearingId, {
      endKind: body.endKind,
      note: body.note,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/hearing-reopens')
  @UseGuards(SameOriginReadGuard)
  async reopen(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.notices.reopenHearing(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/new-fact-returns')
  @UseGuards(SameOriginReadGuard)
  async newFact(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.notices.returnToInvestigation(req.actor as ActorRef, id, { note: body.note });
    res.status(outcome.status).json(outcome.body);
  }
}