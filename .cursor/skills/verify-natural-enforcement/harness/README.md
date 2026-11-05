# API Verification harness

读 `fixtures/scenarios` / `fixtures/negatives` → 投影 case-profile `system` → 登录 → `POST /api/clues` → 评结构化 oracle → 写 `.run/verify-<runId>/`。

入口：容器内 `./dev test integration`（`integration/verify-skill-loop.test.ts`）。
禁止在宿主机 `pnpm install`。

本轮必绿：`vf-sc-verify-loop-survey-register`（01）、`vf-sc-verify-loop-land-register`（02）、
`vf-sc-neg-type-unconfirmed`（01）、`vf-sc-neg-missing-narrative`（02）。

## 只跑 verify-skill-loop（避开 e3 拖红）

整入口 `./dev test integration` 在 Vitest 之后还会跑 `integration/*.sh`；其中 `e3-immutable-storage.sh` 可能因缺 `/repo/packages/storage/src/e3-driver.ts` 把整层拖红（另记债，本轮不修 e3）。

快路径（只验本环、宿主落盘 `.run/verify-*`）：

```bash
mkdir -p .run
INTEGRATION_SKIP_SCRIPTS=1 \
INTEGRATION_VITEST_ARGS='integration/verify-skill-loop.test.ts' \
  ./dev test integration
```

`./dev` 已把宿主 `.run` bind-mount 到容器 `/work/.run`，EvidenceWriter 写出的 `.run/verify-<runId>/` 在宿主可见。


## 只跑 verify（避开 e3 脚本）

整层 `./dev test integration` 在 Vitest 之后会跑 `integration/*.sh`；当前 `e3-immutable-storage.sh` 可能因缺 `/repo/packages/storage/src/e3-driver.ts` 拖红（另记债，本轮不修）。

只跑 API 环四条：

```bash
mkdir -p .run
INTEGRATION_SKIP_SCRIPTS=1 INTEGRATION_VITEST_ARGS=integration/verify-skill-loop.test.ts ./dev test integration
```

- `INTEGRATION_VITEST_ARGS`：传给容器内 `vitest run` 的文件／过滤参数。
- `INTEGRATION_SKIP_SCRIPTS=1`：跳过 `integration/*.sh`。
- 证据：`./dev` 将宿主 `.run` bind-mount 到容器 `/work/.run`，跑完可在宿主读 `.run/verify-<runId>/summary.json`。

证据落盘（Podman）：integration Vitest 把 `.run` 写到 named volume `${COMPOSE_PROJECT_NAME:-natural-enforcement}-verify-run`，`./dev` 再 tar 抽回宿主 `.run/`（WSL home bind-mount 在 Podman machine 下不可见，故不用 `-v "$ROOT/.run:/work/.run"`）。
