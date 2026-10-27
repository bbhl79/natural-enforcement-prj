// 人员层利害关系 HTTP 入口（#237）。
// 登记声明走 doc.draft，回避决定走 doc.approve。二者都是过渡复用，不新增操作码。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { CaseConflictService } from './case-conflict.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

@Controller()
export class CaseConflictController {
  constructor(private readonly conflicts: CaseConflictService) {}

  @Get('api/cases/:id/conflicts')
  @UseGuards(SameOriginReadGuard)
  async list(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.conflicts.list(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/conflicts')
  @UseGuards(SameOriginReadGuard)
  async declare(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly personId?: unknown; readonly source?: unknown; readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.conflicts.declare(req.actor as ActorRef, id, {
      personId: typeof body.personId === 'string' ? body.personId : '',
      source: typeof body.source === 'string' ? body.source : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/conflicts/:lineageId/decisions')
  @UseGuards(SameOriginReadGuard)
  async decide(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Param('lineageId') lineageId: string,
    @Body() body: { readonly conclusion?: unknown; readonly reason?: unknown },
  ): Promise<void> {
    const outcome = await this.conflicts.decide(req.actor as ActorRef, id, lineageId, {
      conclusion: typeof body.conclusion === 'string' ? body.conclusion : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/sign-checks')
  @UseGuards(SameOriginReadGuard)
  async sign(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly personId?: unknown; readonly signKind?: unknown },
  ): Promise<void> {
    const actor = req.actor as ActorRef;
    const outcome = await this.conflicts.assertCanSign(
      actor,
      id,
      typeof body.personId === 'string' && body.personId !== '' ? body.personId : actor.personnelId,
      typeof body.signKind === 'string' ? body.signKind : '',
    );
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/investigation-entries')
  @UseGuards(SameOriginReadGuard)
  async investigate(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly kind?: unknown; readonly summary?: unknown },
  ): Promise<void> {
    const outcome = await this.conflicts.recordInvestigation(req.actor as ActorRef, id, {
      kind: typeof body.kind === 'string' ? body.kind : '',
      summary: typeof body.summary === 'string' ? body.summary : '',
    });
    res.status(outcome.status).json(outcome.body);
  }

  @Post('api/cases/:id/legal-review-candidates')
  @UseGuards(SameOriginReadGuard)
  async candidates(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: { readonly personIds?: unknown },
  ): Promise<void> {
    const personIds = Array.isArray(body.personIds)
      ? body.personIds.filter((item): item is string => typeof item === 'string')
      : [];
    const outcome = await this.conflicts.filterLegalReviewCandidates(req.actor as ActorRef, id, personIds);
    res.status(outcome.status).json(outcome.body);
  }
}
