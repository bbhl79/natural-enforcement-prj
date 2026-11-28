// 生命周期决策引擎 → devenv 的 op 行协议发射器（#106）。
// CLI 是纯决策引擎：不落盘；写/删/校验运行全部以协议行输出，由 devenv 宿主侧原子应用。
import * as process from 'node:process'

export type Op =
  | { op: 'W'; path: string; content: string }
  | { op: 'D'; path: string }
  | { op: 'V'; id: string; expect: 'fail' | 'pass'; content: string }

/** 输出边界：protocol = 容器 stdout（宿主 bash 解析），human = 容器 stderr（人读）。 */
export interface OpSink {
  protocol(line: string): void
  human(line: string): void
}

export const processSink: OpSink = {
  protocol: (line) => process.stdout.write(`${line}\n`),
  human: (line) => process.stderr.write(`${line}\n`),
}

export function emit(_sink: OpSink, _op: Op): void {
  throw new Error('not implemented')
}

export function end(_sink: OpSink, _status: 'ok' | 'error', _code: number, _message: string): number {
  throw new Error('not implemented')
}

export function human(_sink: OpSink, _msg: string): void {
  throw new Error('not implemented')
}