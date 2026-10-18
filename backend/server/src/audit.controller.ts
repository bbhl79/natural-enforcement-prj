import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { AuditBrowseService, type AuditFilterInput } from './audit-browse.service.ts';
import { sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';
import { XLSX_CONTENT_TYPE } from './xlsx.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  send(body: Buffer): void;
}

function filterOf(body: unknown): AuditFilterInput {
  return body && typeof body === 'object' ? (body as AuditFilterInput) : {};
}

/**
 * 管理台留痕（#126）。查阅和导出都要先写留痕，是写请求，走 POST，受框架内建的跨站防护（#91）。
 * 首页条数只读、不写留痕（被拒时写 authz.denied），走 GET。
 */
@Controller('api/admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditBrowseService) {}

  @Post('query')
  async query(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Body() body: unknown): Promise<void> {
    const outcome = await this.audit.query(req.actor as ActorRef, filterOf(body), sourceAddress(req));
    res.status(outcome.status).json(outcome.body);
  }

  @Post('export')
  async export(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Body() body: unknown): Promise<void> {
    const outcome = await this.audit.export(req.actor as ActorRef, filterOf(body), sourceAddress(req));
    if (outcome.status !== 200) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-trail.xlsx"; filename*=UTF-8''${encodeURIComponent(outcome.filename)}`,
    );
    res.setHeader('X-Item-Count', String(outcome.itemCount));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(outcome.file);
  }

  @Get('summary')
  async summary(@Req() req: AuthenticatedRequest, @Res() res: HttpReply): Promise<void> {
    const outcome = await this.audit.summary(req.actor as ActorRef);
    res.status(outcome.status).json(outcome.body);
  }
}
