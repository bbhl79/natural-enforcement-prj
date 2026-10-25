// 线索缺件补齐接口（#211；规格 E）。
//
// POST /api/clues/:id/gaps/fill：一次提交可补一项，也可一次补多项。
// 请求体：{ values: { "<要件键>": "<取值>" } }。
// 同一次提交里任一项不合格则全部不保存：返回 400 non-compliant，业务行不变。

import { Body, Controller, Param, Post, Req, Res } from '@nestjs/common';

import type { ClueFormValues } from '@natural-enforcement/case';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueItemSupplementService } from './clue-item-supplement.service.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface FillBody {
  values?: unknown;
}

@Controller('api')
export class ClueItemSupplementController {
  constructor(private readonly supplement: ClueItemSupplementService) {}

  @Post('clues/:id/gaps/fill')
  async fill(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') clueId: string,
    @Body() body: FillBody,
  ): Promise<void> {
    const actor = req.actor as ActorRef;
    const outcome = await this.supplement.fill(actor, clueId, readValues(body));
    res.status(outcome.status).json(outcome.body);
  }
}

/** 取值一律按字符串读：非字符串的取值不进表单。 */
function readValues(body: FillBody | undefined): ClueFormValues {
  const raw = body?.values;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => [key, value as string] as const);
  return Object.fromEntries(entries);
}
