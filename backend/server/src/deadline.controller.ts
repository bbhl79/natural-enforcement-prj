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

@Controller()
export class DeadlineController {
  constructor(private readonly deadlines: DeadlineService) {}

  @Get('api/cases/:id/deadlines')
  @UseGuards(SameOriginReadGuard)
  async read(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.deadlines.read(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

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

  @Post('api/deadline-approvals/:id/submit')
  @UseGuards(SameOriginReadGuard)
  async submit(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.deadlines.submit(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

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
