# API Verification harness

读 `fixtures/scenarios` / `fixtures/negatives` → 登录 → 按步骤执行 → 评结构化 oracle → 写 `e2e/results/verify-<runId>/`。

## 动作

| action | 说明 |
| ---- | ---- |
| `register-clue` | 投影 case-profile `system` 后 `POST /api/clues`；`body.id` 写入后续步骤的 `clueId` |
| `poll-verification` | 短轮询 `GET /api/clues/:id/verification`（默认 10 次／500ms）；done／failed／not_required／running 都记证据，worker 没跑成不判红 |
| `read-dispatch` | `GET /api/clues/:id/dispatch`，留 suggestion／candidates 证据 |
| `decide` | 仅当视图状态 `pending_decision` 时 `POST /api/clues/:id/decide`；否则记 skipped 证据继续 |
| `assign-org` | `POST /api/clues/:id/assign-org`；机构按 `orgUnitCode` 从 `/api/org-units` 解析，或 `orgUnitFrom=assignment` |
| `assign-people` | `POST /api/clues/:id/assign-people`；主办／协办按工号从视图 `candidates` 解析 |
| `read-dispatch-buttons` | 矩阵里的每个身份自己 `GET /api/clues/:id/dispatch`，核已有按钮开关。403 原样记下。 |

下一待办按钮（不改产品权限，不改工作台过滤）：

```bash
e2e/verify/harness/run-next-todo-buttons.sh
```

页面只 headless，不点写。证据在 `e2e/results/verify-<runId>/`。
分派视图读取按录入机构或已有承办机构的并集核对。`readScope` 为 `entered-or-assigned-org`。
未派机构时，甲所内勤仍是 403 `scope-denied`。已派到甲所后，甲所内勤 200，且 `mayAssignPeople=true`。

分派视图默认用本步身份读取。未派机构时承办机构内勤读不到录入机构视图，步骤可声明 `viewIdentityRef`（如录入人）单独读视图。

开发环境自动核查（空地址失败，以及假图层上的成功、部分命中、疑似重复）：

```bash
e2e/verify/harness/run-auto-verification.sh
```

假图层说明见 `layers/README.md`。页面取证只 headless。

入口：容器内 `./dev test integration`（`integration/verify-skill-loop.test.ts`）。
禁止在宿主机 `pnpm install`。

## 认证与传输门禁

登录不是 200，或传输地址不可达时，summary 为 `blocked`，进程退出。
同一次跑不得再试口令，不得改来源，不得清 Redis，不得用 SQL 改密，不得为清门禁重启。
`BASE_URL` 不得指向 compose 服务名 `nginx`。
`host.docker.internal` 不可达时停止。
身份准备见 `IDENTITY-PREP.md`。
业务跑次只使用 `VERIFY_LOGIN_PASSWORD` 或夹具种子口令中的一个。
P1 无回溯上限样本的 driver 是 `run-hist-dup-no-lookback.sh`。
其余 P1 项、P2、P3 见 `BACKLOG-STUBS.md`。

本轮必绿：`vf-sc-verify-loop-survey-register`（01）、`vf-sc-verify-loop-land-register`（02）、
`vf-sc-neg-type-unconfirmed`（01）、`vf-sc-neg-missing-narrative`（02）。

## 只跑 verify-skill-loop（跳过 integration 脚本）

整入口 `./dev test integration` 在 Vitest 之后还会跑 `integration/*.sh`；其中 `e3-immutable-storage.sh` 要起临时 RustFS，耗时较长。该脚本把驱动源码经 tar 送进容器，不依赖宿主 bind-mount，Podman 下可以通过。

快路径（只验本环、宿主落盘 `e2e/results/verify-*`）：

```bash
mkdir -p e2e/results
INTEGRATION_SKIP_SCRIPTS=1 \
INTEGRATION_VITEST_ARGS='integration/verify-skill-loop.test.ts' \
  ./dev test integration
```

EvidenceWriter 写出的 `e2e/results/verify-<runId>/` 先落在容器的命名卷里，`./dev` 跑完再用 tar 抽回宿主（见本文末「证据落盘（Podman）」）。


## 只跑 verify（跳过 integration 脚本）

整层 `./dev test integration` 在 Vitest 之后会跑 `integration/*.sh`，其中 e3 脚本耗时较长。

只跑 API 环四条：

```bash
mkdir -p e2e/results
INTEGRATION_SKIP_SCRIPTS=1 INTEGRATION_VITEST_ARGS=integration/verify-skill-loop.test.ts ./dev test integration
```

- `INTEGRATION_VITEST_ARGS`：传给容器内 `vitest run` 的文件／过滤参数。
- `INTEGRATION_SKIP_SCRIPTS=1`：跳过 `integration/*.sh`。
- 证据：跑完可在宿主读 `e2e/results/verify-<runId>/summary.json`（经命名卷与 tar 抽回，不用 bind-mount）。

证据落盘（Podman）：integration Vitest 把 `e2e/results` 写到 named volume `${COMPOSE_PROJECT_NAME:-natural-enforcement}-verify-run`，`./dev` 再 tar 抽回宿主 `e2e/results/`（WSL home bind-mount 在 Podman machine 下不可见，故不用 `-v "$ROOT/e2e/results:/work/e2e/results"`）。
