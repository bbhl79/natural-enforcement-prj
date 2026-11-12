// 用途：提供撤回不派的 HTTP 接口，解析原因多选、说明与预期状态后委托 ClueWithdrawService。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/clue-withdraw.service.ts（#217；规格 D/H 节）。
//
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

// 撤回不派的 HTTP 入口，请求处理全部委托 ClueWithdrawService。
@Controller('api/clues')
export class ClueWithdrawController {
  constructor(private readonly withdrawal: ClueWithdrawService) {}

  /** 撤回不派。 */
  // 撤回不派，成功后线索回待分派池；操作码 clue.withdraw.undo；对象级限录入人本人、录入机构内勤或所撞既有线索的承办机构内勤。
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
