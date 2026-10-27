// 调查环节与收尾的 HTTP 入口（#236）。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { InvestigationService } from './investigation.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class InvestigationController {
  constructor(private readonly investigation: InvestigationService) {}

  @Get('api/cases/:id/investigation')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.investigation.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/violations')
  @UseGuards(SameOriginReadGuard)
  async saveViolation(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly behaviorDescription?: unknown;
      readonly parties?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
      readonly recognition?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.investigation.saveViolation(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/violations/:recordId/void')
  @UseGuards(SameOriginReadGuard)
  async voidViolation(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('recordId') recordId: string,
    @Body() body: { readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.voidViolation(req.actor as ActorRef, id, recordId, {
      reason: body.reason,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/inquiries')
  @UseGuards(SameOriginReadGuard)
  async saveInquiry(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: {
      readonly occurredAt?: unknown;
      readonly place?: unknown;
      readonly interviewee?: unknown;
      readonly officerIds?: unknown;
      readonly attachmentName?: unknown;
    },
  ): Promise<void> {
    const outcome = await this.investigation.saveInquiry(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/party-notices')
  @UseGuards(SameOriginReadGuard)
  async saveNotice(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly occasion?: unknown; readonly note?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.saveNotice(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/procedures')
  @UseGuards(SameOriginReadGuard)
  async saveDraft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly kind?: unknown; readonly reason?: unknown; readonly extendTogether?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.saveDraft(req.actor as ActorRef, id, body);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/procedures/:id/submit')
  @UseGuards(SameOriginReadGuard)
  async submit(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.investigation.submit(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/procedures/:id/review')
  @UseGuards(SameOriginReadGuard)
  async review(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.review(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/procedures/:id/approve')
  @UseGuards(SameOriginReadGuard)
  async approve(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.approve(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/procedures/:id/return')
  @UseGuards(SameOriginReadGuard)
  async returnToDraft(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly opinion?: unknown },
  ): Promise<void> {
    const outcome = await this.investigation.returnToDraft(req.actor as ActorRef, id, {
      opinion: typeof body.opinion === 'string' ? body.opinion : null,
    });
    res.status(outcome.status).json(outcome.body);
  }
}
