# #62 并发 web 入口与可观察命令面 — Windows（WSL2）验收证据

日期：2026-11-26 ｜ 机器：Windows WSL2 + Rancher Desktop podman machine（rootful，
`podman-root.sock`）｜ 引擎：Podman Engine 6.1.4（linux/amd64）｜ 代码：
`feat/web-concurrency-62` @ `7f9aa52`（实现 `adcde9f` + 复审修复 `7f9aa52`）

本目录是 #62 五条验收标准的实机证据。一次连续运行（`results.tsv` / `checks.txt`
完整清单），日志先写 `/tmp/ne62-evidence` 再归档——避免证据文件进入工作树快照
改变构建输入（#58 快照机制）。A = 主 worktree（`natural-enforcement-90e22128`），
B = 同提交 detached 临时 worktree（`natural-enforcement-f6c59a50`，
`/home/hulei815/Workspaces/ne-62-evidence-b`，已随收尾删除）。

## 验收对照

| #62 标准 | 证据 | 结果 |
|---|---|---|
| 两进程同时执行 web，实际绑定不同端口并成功访问（不以"探测时空闲"代替真实并发验收） | `02-*`：A/B 两个 `devenv --json web` **同时**执行（`&` + `wait`），均 rc 0；A=32931、B=33333 引擎原子分配；宿主 curl 双方均 HTTP 200 | ✅ |
| 实际端口进入 JSON 终值与 status，可按 worktree 明确查询 | `02-a-web.out` / `02-b-web.out` 终值含 `port`/`url`；`02-a-status.out` / `02-b-status.out` 各自 `web_port`/`web_url` 与实际一致（按本 worktree 项目标签回读） | ✅ |
| exec/shell/logs 保持子进程原始流，JSON 仅包装独立终值元数据 | `05-a-exec-json.*`：rc 3 原样传播、stdout 全 JSON（引擎事件+终值）、`raw-out`/`err-line` 全在 stderr；`05-a-logs-json.*` 同口径；`05b-a-exec-raw.out`：非 --json 时原始流保持 stdout（无终值包装） | ✅ |
| API/数据库调试经 exec/shell/logs，不新增宿主调试端口 | `02-a-ps.out` / `02-b-ps.out`：db 仅容器内网 `5432/tcp`、api 无发布端口、web 是唯一宿主端口；离线 C1 静态守卫 compose.yaml 仅 web 有 `ports:` | ✅ |
| 错误消息含服务/路径、具体违规、内嵌修复命令；Windows 证据随票留存 | `03-b-web-steal-a.err`（容器占用者具名 + 修复命令）；`04-b-web-noncontainer.err`（非容器占用者区分）；本目录即证据 | ✅ |

## 关键场景

### 02 并发 web（核心验收）

`02-a-web-down` 先确保 A 无 web 容器（双方都是真实新绑定，不是幂等重放）。随后
A、B 的 `devenv --json web` 真正并发启动：各持 per-worktree 栈锁（互不阻塞），
引擎在绑定时原子分配宿主端口——A 得 32931、B 得 33333（`02-ports.txt`），
宿主 curl 双方 `/` 均 200。分配机制无"探测空闲→再绑定"窗口：compose 注入裸
容器端口 `"4173"`，绑定即分配，两进程不可能得到同一端口。

### 03 显式端口冲突（容器占用者）

B 执行 `devenv web --port 32931`（A 的实际端口）：引擎真实绑定失败
（`cannot bind tcp port 0.0.0.0:32931: address already in use`），诊断识别占用者
为 A 的 web 容器（`docker ps` Ports 文本匹配——podman 不支持 `publish` 过滤器，
实测），exit 3，错误含服务 [web]、端口、占用者容器/项目名、三条修复命令。
失败后 A 的 web 仍 200（`03` 第三项检查）。

### 04 显式端口冲突（非容器占用者）

宿主 `python3 -m http.server 8077` 占位后 B 执行 `--port 8077`：无容器发布该端口，
但 127.0.0.1:8077 可连接（纯 bash `/dev/tcp` 探测）→ 如实报"非容器进程占用"，
exit 3。与 03 的消息口径区分占用者类型。

### 05 透传命令 --json 包装

`exec -- sh -c 'echo raw-out; echo err-line >&2; exit 3'`：退出码 3 原样传播；
stdout 仅 `{"event":"engine",...}` + `{"command":"exec","status":"failed","exitCode":3}`；
子进程两路原始流均在 stderr。`logs api --tail 5` 同口径。`05b` 非 --json exec：
原始 stdout 原通道透传（可管道消费），无终值包装。

### 06 重复 web 幂等

配置未变（镜像与端口规格均未变）时再次 `devenv --json web`：容器 ID 不变
（不重建）、端口 32931 稳定。**注意口径**：端口稳定于容器生命周期；代码变更
（重建）或 `web --down` 后的下次启动得到新的引擎分配端口——消费方一律读终值/
status，不假定端口（人需固定地址用 `--port N`）。

## 文件索引

| 文件 | 内容 |
|---|---|
| `00-*` | 开工基线（A doctor/status、HEAD、worktree 清单） |
| `01-*` | B worktree 建立、doctor、首次 up（快照同 A → 镜像新鲜度命中不重建）、status |
| `02-a-web.out` / `02-b-web.out` | 并发 web 的 JSONL 事件流与终值（含实际端口） |
| `02-ports.txt` | 双方端口与 HTTP 状态汇总 |
| `02-{a,b}-status.out` / `02-{a,b}-ps.out` | 并发期间双 worktree 的 status（web_port）与 ps（发布端口列） |
| `03-b-web-steal-a.*` / `03-b-web-restore.*` | 容器占用者冲突（exit 3）与 B 恢复 |
| `04-b-web-noncontainer.*` | 非容器占用者冲突（exit 3） |
| `05-a-exec-json.*` / `05-a-logs-json.*` / `05b-a-exec-raw.*` | 透传命令 --json 包装与非 --json 原通道 |
| `06-a-web-again.*` | 重复 web 幂等（容器不变、端口稳定） |
| `07-*` | 收尾：B 拆栈删卷删 worktree；A up 恢复；doctor 通过；锁/租约全释放 |
| `results.tsv` / `checks.txt` | 全部命令退出码清单 / 20 项检查全 PASS |
| `tools/run-evidence.sh` | 可复跑驱动（见下） |

## 复跑

```bash
# 前置：主 worktree 干净（栈可起；驱动自行 up）。约 3–4 分钟；会真实建/删
# 临时 worktree B（同提交 detached）及其数据卷，并短暂占用两个宿主端口。
bash docs/evidence/62-web-concurrency/tools/run-evidence.sh all
```

驱动把日志写 `/tmp/ne62-evidence`（不写仓库，避免快照抖动）；跑完人工拷回本目录。

## 诚实备注

- **分配机制**：省略 `--port` 时端口由引擎在容器绑定时原子分配（内核临时端口段），
  不存在"探测时空闲"窗口；`port_in_use` 探测只用于显式 `--port` 失败**之后**的
  占用者分类，不参与分配决策。
- **端口稳定性**：仅覆盖同配置重复执行（06）；重建/重发后端口变化是设计口径，
  消费方必须读 JSON 终值或 status（本目录 02 证明该链路可用）。
- **03 的 B 侧代价**：compose 重建语义下，B 失败的抢端口尝试会移除 B 原 web
  容器（随后 `03-b-web-restore` 恢复新端口）；A 侧不受影响（已验证 200）。
- **占用者识别边界**：容器占用者识别依赖 `docker ps` 的 Ports 文本（`：port->`），
  覆盖 docker/podman 本机引擎；非本机引擎/远程引擎场景不在承诺矩阵内。
- **遗留项目 warn**：`00`/`07` doctor 的 `legacy-project` warn 是 #59 前共享项目
  的未回收容器，与本票无关，回收归 #75。
- 运行结束后本机栈已恢复（`07-a-up` rc 0、`07-a-doctor` 通过、锁/租约为空），
  临时 worktree B 及其卷已删除（`07-worktrees-after.txt`）。
