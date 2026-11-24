# GitHub App 认证入口

本仓库的 GitHub 操作（gh / git push）默认以 **GitHub App `bbhl79-agent`** 身份执行，
而不是个人账号。入口统一在 devenv：

```bash
./devenv/devenv gh <args...>                 # gh 操作（拒绝 gh auth；拒绝 -R 指向未授权仓库）
./devenv/devenv git-push <remote> <refspec...>  # HTTPS 推送（只接受已配置 remote 名）
./devenv/devenv test:auth                    # 离线测试（不访问 GitHub）
./devenv/devenv test:auth:integration        # 真实集成测试（默认只读）
```

## 身份模型：声明 vs 授权

| 层 | 位置 | 内容 | 性质 |
|---|---|---|---|
| 身份声明 | 仓库内 `devenv/github-app.json` | app_id、slug、允许仓库 | 非敏感，随分支走 |
| 本机授权 | `~/.config/github-apps/bbhl79-agent/authorization.json` | app_id、slug、installation_id、私钥路径、允许仓库 | 本机事实源，不入库 |
| 私钥 | `~/.config/github-apps/bbhl79-agent/*.private-key.pem`（600，目录 700） | RSA 私钥 | 只由签名步骤读取 |

每次调用双向匹配：声明的 app_id/slug 必须等于授权的 app_id/slug；当前 origin 仓库
必须同时在声明与本机授权的允许清单内。**分支里的声明不能扩大授权范围**——篡改
声明只会导致拒绝执行。

## 工作原理

1. 每次调用用私钥经 openssl 签发 RS256 JWT（iat 回拨 60s，exp 9 分钟）。
2. `POST /app/installations/{id}/access_tokens`，请求体显式限定
   `repositories: ["natural-enforcement-prj"]`，换取仅 1 小时有效、仅目标仓库的
   installation token。
3. token 只存在于内存与本次子进程环境：**不缓存、不打印、不进命令参数、不写文件、
   不进日志**。每次调用重新换取（含并发），不依赖进程启动时注入的任何 token。
4. `devenv gh`：`env -u` 排除继承的 `GITHUB_TOKEN`/`GH_TOKEN`/`GH_CONFIG_DIR` 等，
   以 `GH_TOKEN=<installation token>` 运行 gh。token 无效时 gh 直接报错退出，
   不存在回退个人登录的路径。
5. `devenv git-push`：校验 remote 的 push URL 归一化后等于授权仓库（拒绝裸 URL
   参数，不改写任何 remote 配置）；按调用用 `-c credential.helper=` 清空继承的
   credential helper（含全局的 `gh auth git-credential`），只挂
   `devenv/bin/github-app-git-credential`（从环境变量取 token 交给 git）；
   `GIT_TERMINAL_PROMPT=0` 禁止交互式回退。**`GH_TOKEN` 对 git push 无效，
   本入口不依赖它**。

## 退出码

0 成功；2 用法错误（含 `gh auth`）；20 声明与授权不符；21 私钥/签名失败；
22 换取 token 失败；23 目标仓库/推送 URL 未授权；其余为 gh/git 自身退出码。
认证失败一律非零退出，**不回退个人凭据**。

## 已接入与未接入的路径

已接入（经 AGENTS.md / CLAUDE.md 指引约束 agent 走入口）：

| 工具 | 项目指引文件 | 依据 |
|---|---|---|
| Kimi Code | `AGENTS.md` | 本会话实测加载 |
| Claude Code（终端 + VS Code 插件） | `CLAUDE.md`（原生）；v2.1.277+ 无 CLAUDE.md 时回退读 `AGENTS.md` | code.claude.com/docs memory |
| Qoder CLI | `AGENTS.md`（默认上下文文件名） | docs.qoder.com/zh/cli/memory |
| Cursor | `AGENTS.md`（官方支持） | cursor.com/docs/rules |
| Zen Code | **未确认**（未找到官方文档依据，未接入） | — |

**未接入、不能声称使用 App 身份的路径**：
- GitHub MCP 服务器（使用其自身配置的凭据）。
- VS Code 内置 Git 推送 / IDE 图形化推送（走编辑器自身凭据链）。
- 任何绕过 devenv 直接调用 `gh` / `git` 的操作——包括 agent 手动执行。
- Windows 侧工具（本入口只在 WSL 内有效）。

## 安全边界（如实声明）

- 这**不是安全隔离**：agent 与人类同系统用户，agent 仍可绕过入口直接读取
  `~/.config/gh`、SSH 密钥或私钥文件，以个人身份发布内容。入口的价值是让
  **合规路径默认是 App 身份**、误用可被检测，而不是阻止恶意绕过。
- 共用一个 App 只能区分「人类 vs 自动化」，**不能区分不同 agent**。
- 分支保护规则约束的是 GitHub 侧合入，不能阻止本机冒用个人身份发 issue/评论。
- 安装当前为 `repository_selection=all`（账号级），入口通过按仓库换取 token
  把实际可用范围收窄到唯一授权仓库；如需安装级收窄，须在 GitHub 网页把安装
  改为 selected repositories（人工操作）。

## 验证

- `./devenv/devenv test:auth`：离线测试（mock curl/gh/push），覆盖授权匹配、
  失败路径、个人凭据排除、仓库限定、并发隔离、双路径、泄露扫描。
- `./devenv/devenv test:auth:integration`：真实只读验证（App 身份、安装、权限、
  token 仓库范围，含匿名对照）。写操作旗标：`--issue-comment N` /
  `--push-test-branch` / `--key-outage`，运行前须获指挥者确认。
