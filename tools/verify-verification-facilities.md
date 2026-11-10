# 真实设施验证：BullMQ attempts 与图层不可用

对应 #213 验收项「真实设施验证 BullMQ attempts 语义与图层服务不可用判 unavailable」。
验证脚本 = `tools/verify-verification-facilities.ts`。脚本不进任何自动化测试层——它要连
真实 Redis 并起真实 HTTP 端点，跑法与普通用例不同。本文件是它的调用规程；脚本头部也
留了同一份命令。

## 验什么

| # | 断言 | 期望输出 |
|---|---|---|
| 1 | BullMQ 的 attempts 含首次执行：投递 attempts=3 的瞬时失败任务，消费端真跑 3 次 | `消费第 1 次`、`消费第 2 次`、`消费第 3 次`；末行 `瞬时任务：消费 3 次（投递 attempts=3）` |
| 2 | 不可重试错误不重试：同样投递 attempts=3，但处理器抛不可重试错误，只跑 1 次 | `不可重试任务：消费 1 次后失败（不重试）` |
| 3 | 图层服务不可用判 unavailable：真实 HTTP 端点回 503，该层判 unavailable，不冒充查过没有 | `图层服务返回 503：该层状态 unavailable，原因 service-unavailable` |

脚本退出码 0 表示三条断言都成立。

## 前置

- **Redis 在场**：脚本经 compose 网络按主机名 `redis` 连。`./dev up` 会拉起；只跑本项时
  `docker compose -f infra/docker-compose.yml up -d redis` 也够（compose 需要
  `DATABASE_URL` 与 `REDIS_URL` 两个派生量，按 `infra/runtime.env` 从分项算出）。
- **工具链镜像在场**：`node:24.21.0-alpine` 钉 digest（见 `infra/VERSIONS.md`），
  `./dev build` 拉取。

## 跑法

灌源形态与 `dev` 各命令一致：tar 经 stdin 灌进容器 `/work`，依赖只进命名卷。

**不用 bind 挂宿主仓库**——WSL 宿主到容器的 bind 只暴露残缺视图（`/repo` 下只剩
`.cursor`、`.run`、`frontend`、`infra`，`packages/` 与 `tools/` 整个不在），bind 形态在
WSL2 上取不到本脚本。

```bash
tar -C "$PWD" --format=ustar \
  --exclude='.git' --exclude='node_modules' --exclude='*/node_modules' \
  --exclude='dist' --exclude='*/dist' --exclude='.run' --exclude='e2e/results' \
  --exclude='backend/prisma/generated' --exclude='artifacts' \
  --exclude='.env' --exclude='.env.local' --exclude='*.local.js' --exclude='*.local' \
  -cf - . \
| docker run --rm --pull=never -i --network natural-enforcement_default \
  -e REDIS_URL=redis://redis:6379 \
  -v natural-enforcement-integration-node-modules:/work/node_modules \
  -v natural-enforcement-test-store:/pnpm/store \
  -v natural-enforcement-corepack:/root/.cache/node/corepack \
  -v natural-enforcement-pnpm-cache:/root/.cache/pnpm \
  -w /work node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 \
  sh -c 'set -e; mkdir -p /work; tar -x -f - -C /work; corepack enable >/dev/null 2>&1; \
    pnpm install --frozen-lockfile --ignore-scripts --config.strict-dep-builds=false \
      --store-dir /pnpm/store --prefer-offline >/dev/null 2>&1; \
    node --experimental-transform-types --experimental-strip-types tools/verify-verification-facilities.ts'
```

## 判读

- 三条断言的期望输出见上表，逐条对上即通过。
- 报 `Cannot find package 'ioredis'` 一类 = 灌装里的 `pnpm install` 没成功（锁文件与
  package.json 不一致，或依赖卷没挂上）。把该步的 `--frozen-lockfile` 去掉重跑，看安装日志。
- 报 `Cannot find module '/repo/...'` = 误用了 bind 挂载形态，见上。
- `MODULE_TYPELESS_PACKAGE_JSON` 警告是已知项：根 `package.json` 没有 `"type": "module"`，
  node 探测到模块语法后按 ESM 重解析。不影响结果。

## 何时重跑

改动 `packages/queue` 的重试语义（attempts、退避、不可重试判定）或 `backend/case` 的
图层可用性判定之后，重跑本项。
