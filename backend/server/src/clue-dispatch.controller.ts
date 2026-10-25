// 分派决定与两步分派接口（#214；规格 H 节写接口）。
//
// POST /api/clues/:id/decide        分派决定（派／不派，默认不派／已知晓／举报必派）
// POST /api/clues/:id/assign-org    派机构（首次分派／重新分派／指定管辖）
// POST /api/clues/:id/assign-people 派主办／协办
// GET  /api/clues/:id/dispatch      分派视图（决定步、两步分派与辖区建议共用一个取数口）
//
// 状态写动作带 expectedStatus，冲突 409 concurrent-change；失败一方有失败留痕、业务行不变。

import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ActorRef } from '@natural-enforcement/identity';

import { ClueDispatchService } from './clue-dispatch.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';
import type { AuthenticatedRequest } from './session.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

interface DecideBody {
  readonly decision?: unknown;
  readonly acknowledged?: unknown;
  readonly expectedStatus?: unknown;
  readonly conflictResolution?: unknown;
  readonly conflictBasis?: unknown;
}

interface AssignOrgBody {
  readonly orgUnitId?: unknown;
  readonly expectedStatus?: unknown;
  readonly reason?: unknown;
  readonly designate?: unknown;
}

interface AssignPeopleBody {
  readonly mainId?: unknown;
  readonly assistIds?: unknown;
  readonly expectedStatus?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : [];
/** 布尔入参：JSON 真值或字符串真值都认。 */
const flag = (value: unknown): boolean => value === true || value === 1 || text(value).toLowerCase() === 'true';

@Controller('api/clues')
export class ClueDispatchController {
  constructor(private readonly dispatch: ClueDispatchService) {}

  /** 分派视图：决定步、派机构、派承办人与辖区建议共用一个取数口。 */
  @Get(':id/dispatch')
  @UseGuards(SameOriginReadGuard)
  async view(@Req() req: AuthenticatedRequest, @Res() res: HttpReply, @Param('id') id: string): Promise<void> {
    const outcome = await this.dispatch.readView(req.actor as ActorRef, id);
    res.status(outcome.status).json(outcome.body);
  }

  /** 分派决定。 */
  @Post(':id/decide')
  async decide(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: DecideBody,
  ): Promise<void> {
    const outcome = await this.dispatch.decide(req.actor as ActorRef, id, {
      decision: text(body?.decision),
      acknowledged: flag(body?.acknowledged),
      expectedStatus: text(body?.expectedStatus),
      conflictResolution: text(body?.conflictResolution) || undefined,
      conflictBasis: text(body?.conflictBasis) || undefined,
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 派机构（首次分派／重新分派／指定管辖）。 */
  @Post(':id/assign-org')
  async assignOrg(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: AssignOrgBody,
  ): Promise<void> {
    const outcome = await this.dispatch.assignOrg(req.actor as ActorRef, id, {
      orgUnitId: text(body?.orgUnitId),
      expectedStatus: text(body?.expectedStatus),
      reason: text(body?.reason),
      designate: flag(body?.designate),
    });
    res.status(outcome.status).json(outcome.body);
  }

  /** 派主办／协办。 */
  @Post(':id/assign-people')
  async assignPeople(
    @Req() req: AuthenticatedRequest,
    @Res() res: HttpReply,
    @Param('id') id: string,
    @Body() body: AssignPeopleBody,
  ): Promise<void> {
    const outcome = await this.dispatch.assignPeople(req.actor as ActorRef, id, {
      mainId: text(body?.mainId),
      assistIds: texts(body?.assistIds),
      expectedStatus: text(body?.expectedStatus),
    });
    res.status(outcome.status).json(outcome.body);
  }
}
