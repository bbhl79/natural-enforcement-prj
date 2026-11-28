// 生命周期决策引擎 → devenv 的 op 行协议发射器（#106；格式由原型定型，ADR 记录）。
//   W\t<relpath>\t<base64(utf8)>   写文件（relpath 相对 apps/e2e）
//   D\t<relpath>                   删文件
//   V\t<id数字段>\t<expect>\t<b64>  校验运行载荷（expect=fail|pass）
//   END\t<status>\t<code>\t<message> 终值（每次调用恰一行，最后输出）
// CLI 是纯决策引擎：不落盘；写/删/校验运行全部以协议行输出，由 devenv 宿主侧原子应用。
// 协议通道（容器 stdout）纯净可被 bash 逐行解析；人类可读摘要走独立通道（stderr）。

export type Op =
  | { op: 'W'; path: string; content: string }
  | { op: 'D'; path: string }
  | { op: 'V'; id: string; expect: 'fail' | 'pass'; content: string }

/** 输出边界：protocol = 容器 stdout（宿主解析），human = 容器 stderr（人读）。 */
export interface OpSink {
  protocol(line: string): void
  human(line: string): void
}

export const processSink: OpSink = {
  protocol: (line) => process.stdout.write(`${line}\n`),
  human: (line) => process.stderr.write(`${line}\n`),
}

function b64(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64')
}

/** 协议按 tab 分字段、按行分记录：路径/标识内的 tab 与换行会截断协议，直接拒绝。 */
function assertField(value: string, what: string): void {
  if (/[\t\r\n]/.test(value)) {
    throw new Error(`op 协议字段含 tab/换行（${what}）：${JSON.stringify(value)}`)
  }
}

export function emit(sink: OpSink, op: Op): void {
  switch (op.op) {
    case 'W':
      assertField(op.path, 'W.path')
      sink.protocol(`W\t${op.path}\t${b64(op.content)}`)
      break
    case 'D':
      assertField(op.path, 'D.path')
      sink.protocol(`D\t${op.path}`)
      break
    case 'V':
      assertField(op.id, 'V.id')
      sink.protocol(`V\t${op.id}\t${op.expect}\t${b64(op.content)}`)
      break
  }
}

/** 终值行：message 内的 tab/换行压平为空格（终值恒为单行），返回该退出码。 */
export function end(sink: OpSink, status: 'ok' | 'error', code: number, message: string): number {
  const flat = message.replace(/[\t\r\n]+/g, ' ')
  sink.protocol(`END\t${status}\t${code}\t${flat}`)
  return code
}

export function human(sink: OpSink, msg: string): void {
  sink.human(msg)
}