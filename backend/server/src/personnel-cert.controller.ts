import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { PersonnelCertsService } from './personnel-cert.service.ts';
import { sourceAddress } from './session-cookie.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface CertBody {
  certNo?: unknown;
  certExpiresOn?: unknown;
  certStatus?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * 管理台执法证（#133）：在人员卡片上逐条登记证号、有效期、证件状态。
 * 跨站写请求由框架 CSRF 拒绝（#105 故事 67）。
 */
@Controller('api/admin')
export class PersonnelCertController {
  constructor(private readonly certs: PersonnelCertsService) {}

  @Post('personnel/:id/cert')
  async update(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: CertBody,
  ): Promise<void> {
    const outcome = await this.certs.update(
      req.actor as ActorRef,
      id,
      {
        certNo: text(body?.certNo),
        certExpiresOn: text(body?.certExpiresOn),
        certStatus: text(body?.certStatus),
      },
      sourceAddress(req),
    );
    res.status(outcome.status).json(outcome.body);
  }
}
