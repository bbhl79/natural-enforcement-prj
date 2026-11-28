// 生命周期决策引擎容器内入口（#106）：devenv 把宿主树经 stdin tar 解包到 /tmp/in
// 后 exec 本进程（--root /tmp/in）。进程不落盘——写盘意图经 op 行协议交宿主原子应用。
// 用 process.exitCode（不用 process.exit）让 stdout 协议行完整冲刷后再退出。
import { runCli } from './cli.js'
import { processSink } from './ops.js'

process.exitCode = runCli(process.argv.slice(2), processSink)