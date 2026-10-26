// 不可重试错误（#213）：队列设施包自己的错误类型，不暴露 BullMQ 的错误类型。
//
// 确定性失败（缺图层、图层服务未配置或不可用、超时、返回不合规）属不可重试：
// 消费方抛出本错误，队列不再自动重试，当次即判失败。只对瞬时错误才走重试口径。

/** 不可重试错误。reason 是失败类别（连字符小写），供业务侧落库与界面提示。 */
export class NonRetryableError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? `不可重试错误：${reason}`);
    this.name = 'NonRetryableError';
    this.reason = reason;
  }
}

/** 判断一个错误是不是不可重试错误。 */
export function isNonRetryableError(error: unknown): error is NonRetryableError {
  return error instanceof NonRetryableError;
}
