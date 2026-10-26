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
 * 查询参数：sourceCode（必填）、domain（必填）、types（可空，多值）。
 * 跨站读请求由 SameOriginReadGuard 拒绝。
 */
@Controller('api')
export class ClueFormSchemaController {
  constructor(private readonly formSchema: ClueFormSchemaService) {}

  /** 参照清单：来源编码与可选违法类型，供录入表单渲染规范选择控件。 */
  @Get('clue/reference')
  @UseGuards(SameOriginReadGuard)
  async reference(@Res() res: HttpReply): Promise<void> {
    const outcome = this.formSchema.reference();
    res.status(outcome.status).json(outcome.body);
  }

  @Get('clue/form-schema')
  @UseGuards(SameOriginReadGuard)
  async schema(@Query() query: FormSchemaQuery, @Res() res: HttpReply): Promise<void> {
    const outcome = this.formSchema.schema(query);
    res.status(outcome.status).json(outcome.body);
  }
}
