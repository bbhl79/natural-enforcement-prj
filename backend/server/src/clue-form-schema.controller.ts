// 用途：提供线索录入要件表单结构与参照清单两个只读 HTTP 接口，返回前端渲染与服务端判定共用的表单声明。
// 调用方：backend/server/src/app.module.ts 注册为控制器。
// 依据：backend/server/src/clue-form-schema.service.ts（#210；ADR 0018）。
//
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';

import { ClueFormSchemaService, type FormSchemaQuery } from './clue-form-schema.service.ts';
import { SameOriginReadGuard } from './same-origin-read.guard.ts';

interface HttpReply {
  status(code: number): HttpReply;
  json(body: unknown): void;
}

/**
 * 录入要件表单结构（#210）。
 * 前端渲染表单与服务端判定缺件读同一份声明（ADR 0018）；本接口只出声明，不写业务事实。
 * 查询参数：sourceCode、domain、types 均可空；来源或法域未选时只出公共层（登记页先出完整表单）。
 * 跨站读请求由 SameOriginReadGuard 拒绝。
 */
@Controller('api')
export class ClueFormSchemaController {
  constructor(private readonly formSchema: ClueFormSchemaService) {}

  /** 参照清单：来源编码与可选违法类型，供录入表单渲染规范选择控件。 */
  // 参照清单：返回来源编码与可选违法类型；无操作码（仅需登录会话）；跨站读请求由 SameOriginReadGuard 拒绝。
  @Get('clue/reference')
  @UseGuards(SameOriginReadGuard)
  async reference(@Res() res: HttpReply): Promise<void> {
    const outcome = this.formSchema.reference();
    res.status(outcome.status).json(outcome.body);
  }

  // 录入要件表单结构：按来源、法域与类型返回表单声明；无操作码（仅需登录会话）；跨站读请求由 SameOriginReadGuard 拒绝。
  @Get('clue/form-schema')
  @UseGuards(SameOriginReadGuard)
  async schema(@Query() query: FormSchemaQuery, @Res() res: HttpReply): Promise<void> {
    const outcome = this.formSchema.schema(query);
    res.status(outcome.status).json(outcome.body);
  }
}
