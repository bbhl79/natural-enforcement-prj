# devenv 命令面（最小骨架：GitHub App 认证入口）

调用形态：`./devenv/devenv <子命令> [参数]`（bash + openssl + curl + jq + git + gh 白名单内）。
本骨架只含认证入口；详细设计与安全边界见 `docs/agents/github-app-auth.md`。

## 命令表（Action | Command | 期望退出码）

| Action | Command | 期望退出码 |
|---|---|---|
| 以 App 身份执行 gh（拒绝 `gh auth`；拒绝 `-R` 指向未授权仓库） | `devenv gh <args...>` | 0 或 2/20/21/22/23 或 gh 自身退出码 |
| 以 App 身份 HTTPS 推送（只接受已配置 remote 名；实际推送地址必须为 https://github.com/ 形式，SSH 及 insteadOf 改写一律拒绝；目标必须授权） | `devenv git-push <remote> <refspec...>` | 0 或 2/20/21/22/23 或 git 自身退出码 |
| 离线测试（不访问 GitHub，默认测试命令） | `devenv test:auth` | 0 或 1 |
| 真实集成测试（默认只读；写操作需显式旗标） | `devenv test:auth:integration [--issue-comment N] [--push-test-branch] [--key-outage]` | 0 或 1 |

## 退出码枚举

| 码 | 含义 | 典型修复 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 用法错误（含被拒绝的 `gh auth`、缺参数） | 按 Usage 提示 |
| 20 | 配置/授权不符（仓库声明与本机授权不匹配、字段缺失） | 核对 `devenv/github-app.json` 与 `~/.config/github-apps/bbhl79-agent/authorization.json` |
| 21 | 私钥缺失 / 权限非 600/400 / JWT 签名失败 | 检查私钥路径与权限 |
| 22 | installation token 换取失败（网络 / 超时 / GitHub 拒绝） | 检查网络与 App 安装状态 |
| 23 | 目标仓库或推送 URL 未授权 | 核对授权仓库清单 |

## 并发语义

- 无共享状态：每次调用独立签发 JWT、独立换取 installation token，不缓存、不复用；
  连续与并发调用各自持有独立 token，互不污染。
- 锁：无（无共享可变资源）。
