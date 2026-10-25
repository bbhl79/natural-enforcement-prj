// 撤回不派接口（#217；规格 D/H 节）。
//
// POST /api/clues/:id/withdraw  撤回不派（四项常用原因多选＋必填说明，成功后回待分派池）
//
// 状态写动作带 expectedStatus，冲突 409 concurrent-change；失败留痕、业务行不变。

import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueWithdrawService } from './clue-withdraw.service.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface WithdrawBody {
  readonly reasonCodes?: unknown;
  readonly note?: unknown;
  readonly expectedStatus?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : [];

@Controller('api/clues')
export class ClueWithdrawController {
  constructor(private readonly withdrawal: ClueWithdrawService) {}

  /** 撤回不派。 */
  @Post(':id/withdraw')
  async withdraw(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: WithdrawBody,
  ): Promise<void> {
    const outcome = await this.withdrawal.withdraw(req.actor as ActorRef, id, {
      reasonCodes: texts(body?.reasonCodes),
      note: text(body?.note),
      expectedStatus: text(body?.expectedStatus),
    });
    res.status(outcome.status).json(outcome.body);
  }
}
