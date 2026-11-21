// PROTOTYPE（#13）— CLI → devenv 操作协议（tab 分隔行协议，stdout 纯净可被 bash 解析）：
//   W\t<relpath>\t<base64>   写文件（relpath 相对 apps/e2e）
//   D\t<relpath>             删文件
//   V\t<id>\t<expect>\t<b64> 校验运行载荷：devenv 写入 .verify-run/ 后真跑一次，expect=fail|pass
//   END\t<status>\t<code>\t<message> 终值（status=ok|error）
// CLI 是纯决策引擎（不落盘）；写/删/跑全部由 devenv 在宿主侧原子执行（全有或全无）。
// 人类/agent 可读摘要走 stderr（--json 时为 JSON 文档）。
import * as process from 'node:process'

export type Op =
  | { op: 'W'; path: string; content: string }
  | { op: 'D'; path: string }
  | { op: 'V'; id: string; expect: 'fail' | 'pass'; content: string }

export function emit(op: Op): void {
  switch (op.op) {
    case 'W':
      process.stdout.write(`W\t${op.path}\t${Buffer.from(op.content, 'utf8').toString('base64')}\n`)
      break
    case 'D':
      process.stdout.write(`D\t${op.path}\n`)
      break
    case 'V':
      process.stdout.write(
        `V\t${op.id}\t${op.expect}\t${Buffer.from(op.content, 'utf8').toString('base64')}\n`,
      )
      break
  }
}

export function end(status: 'ok' | 'error', code: number, message: string): number {
  process.stdout.write(`END\t${status}\t${code}\t${message}\n`)
  return code
}

export function human(msg: string): void {
  process.stderr.write(`${msg}\n`)
}
