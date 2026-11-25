# devenv 命令面（最小骨架：GitHub App 认证入口）

调用形态：`./devenv/devenv <子命令> [参数]`（bash + openssl + curl + jq + git + gh 白名单内）。
本骨架只含认证入口；详细设计与安全边界见 `docs/agents/github-app-auth.md`。

## 命令表（Action | Command | 期望退出码）

| Action | Command | 期望退出码 |
|---|---|---|
| 以 App 身份执行 gh（拒绝 `gh auth`；拒绝 `-R` 指向未授权仓库） | `devenv gh <args...>` | 0 或 2/20/21/22/23 或 gh 自身退出码 |
| 以 App 身份 HTTPS 推送（只接受已配置 remote 名；实际推送地址必须为 https://github.com/ 形式，SSH 及 insteadOf 改写一律拒绝；目标必须授权） | `devenv git-push <remote> <refspec...>` | 0 或 2/20/21/22/23 或 git 自身退出码 |
| 离线测试（不访问 GitHub，默认测试命令） | `devenv test:auth` | 0 或 1 |
| 真实集成测试（默认只读；写操作需显式旗标；证据留存见下） | `devenv test:auth:integration [--issue-comment N] [--push-test-branch] [--key-outage] [--sustained[=N]] [--evidence-dir PATH]` | 0 或 1 或 2（用法错误） |

集成测试旗标（验收项 10 j–m，issue #55）：

- `--issue-comment N`：在 issue N 发测试评论，按评论 ID 核验作者为 App bot（项 j 证据）。
- `--push-test-branch`：向专用草稿分支 `test/app-auth-push` 强推测试提交（`+refspec` 覆盖，
  可重入），按 `after == 本次 sha` 核验推送者为 App bot（项 j 证据）。
- `--key-outage`：临时 chmod 000 私钥（自动恢复 600），验证 `gh`/`git-push` 双路径均以
  21 失败且个人 gh 登录仍在；恢复后核验远端无回退推送产物（项 l 证据）。
- `--sustained[=N]`：持续运行验收（项 k）——操作 → 等待 N 秒（默认 3700，>3600 才作
  项 k 证据）→ 再次操作。主证据：超过 token 1h 生命周期后操作仍成功 ⟹ 入口重新换取
  （复用旧 token 必然 401）；佐证：同一 mint 函数两次 in-process 调用哈希比对不同
  （每次调用重新换取的结构性证明见离线测试 T11/T15）。
- `--evidence-dir PATH`：证据目录，默认 `.artifacts/auth-acceptance/<UTC 时间戳>/`
  （`.artifacts/` 已 gitignore）。每次运行记录进程链（项 j 会话宿主证据）、全部命令与
  退出码；结尾对证据目录与仓库工作树做泄露扫描（活 token 精确值 / `ghs_` 形态 / PEM
  标记，项 m），并输出 j–m 验收映射摘要（`summary.txt`）。

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
