# devenv 命令面（PROTOTYPE #11 验证版）

调用形态：`./devenv/devenv [--json] <子命令> [参数]`（bash + docker 白名单内，其余全容器内）。
全局旗标 `--json`：短命令 stdout 单 JSON；长命令 JSONL 事件流（终值 `{"command":...,"status":...,"exitCode":N}`）。
进度一律 stderr；stdout 保持可管道。输入保持扁平子命令+枚举参数（不做 JSON 入参）。

## 命令表（Action | Command | 期望退出码）

| Action | Command | 期望退出码 |
|---|---|---|
| 全量构建（tools 基座 + workspace 镜像：install+turbo build） | `devenv build` | 0 |
| 启动基础设施 + api 并等待健康（幂等） | `devenv up` | 0 |
| 停止（保留数据卷 / `--volumes` 连带清除） | `devenv down [--volumes]` | 0 |
| 重启服务 | `devenv restart [svc...]` | 0 |
| 容器状态（机读：JSONL 每容器一行） | `devenv ps [-a] [--json]` | 0 |
| 跟随日志 | `devenv logs [svc] [-f]` | 0 |
| 容器内执行（默认 tools；svc 可选 db/redis/rustfs/api） | `devenv exec [svc] -- cmd...` | 任务退出码 |
| 交互 shell | `devenv shell [svc]` | 0 |
| 单元+集成测试（需先 up） | `devenv test [vitest过滤器...]` | 0 或 4 |
| 仅单元测试（无需基础设施，turbo 缓存） | `devenv test:unit` | 0 或 4 |
| ESLint | `devenv lint` | 0 或 4 |
| tsc --noEmit | `devenv typecheck` | 0 或 4 |
| 应用全部 pending 迁移（migrate deploy，独占锁） | `devenv migrate` | 0 |
| 生成空迁移待手写（migrate dev --create-only，独占锁） | `devenv migrate:create --name <snake_case>` | 0 |
| 幂等种子 | `devenv seed` | 0 |
| 等待服务健康（杜绝 sleep 轮询） | `devenv wait <db\|redis\|rustfs\|api> [--timeout N]` | 0 或 5 |
| 一键体检（退出码=可开工与否） | `devenv doctor` | 0 或 3 |
| 人读总览 | `devenv status` | 0 |
| 镜像锁查看 / 运行态漂移校验 | `devenv images [--verify]` | 0 或 1 |

## 退出码枚举

| 码 | 含义 | 典型修复 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法错误 | 按 Usage 提示 |
| 3 | 环境未就绪 | `devenv build` / `devenv up`（错误消息内嵌修复命令） |
| 4 | 任务失败（test/lint/build 非零） | 读任务输出 |
| 5 | 超时（健康等待） | `devenv logs <svc>` |
| 6 | 独占锁冲突 | 查 `devenv status` 的锁列表，稍后重试 |

## 并发语义

- 只读命令（ps/logs/status/images）：任意并发。
- 共享命令（up/down/restart/test/lint/typecheck/seed）：可并发（compose 幂等 + 各自临时容器）。
- 独占命令（build / migrate / migrate:create）：`flock /tmp/natural-enforcement-locks/<name>.lock`，等待 10–120s 后报退出码 6。锁跨 worktree 生效（机器级路径）。

## 架构注记（本原型实测环境）

- 运行时为 Rancher Desktop podman machine（bind mount 不可用，见 NOTES.md）→ 代码烘焙进 workspace 镜像；源码变更后先 `devenv build`（层缓存命中秒级）。
- 基础设施容器不发布宿主端口：跨容器访问全走 compose 内网 DNS（db/redis/rustfs/api）。
