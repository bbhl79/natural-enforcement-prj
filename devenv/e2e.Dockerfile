# PROTOTYPE（#13）— e2e 执行器镜像：官方 Playwright 镜像 + 项目 e2e 运行时。
# 官方 Dockerfile 同款思路（playwright-e2e.md §1.1：需要项目运行时以官方镜像为基座自建）：
# 浏览器/字体/系统依赖零自管；npm 包 @playwright/test 与基座 tag 严格同版本（images.lock PLAYWRIGHT_IMAGE）。
# 无 bind 架构：e2e 代码/配置/测试/replay 脚本全部 COPY 入镜像（改动 = devenv 秒级增量重建）。
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble
FROM ${PLAYWRIGHT_IMAGE}

# Node 26 起官方镜像不捆绑 coreutils-pnpm（同 tools.Dockerfile 的决策）
RUN npm install -g pnpm@12.21.0

WORKDIR /workspace
# manifest 层（与 workspace.Dockerfile 同款显式清单——新包必须进清单，坑记录 NOTES-slice2 §4）
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
# @gen:pkg-copy
RUN pnpm install --frozen-lockfile --filter @ne/e2e...

# 源码层：e2e 包 + 契约包（build 供 dist/cli.js 与 schema 消费面）
COPY packages/contracts packages/contracts
COPY apps/e2e apps/e2e
RUN pnpm --filter @ne/contracts run build && pnpm --filter @ne/e2e run build

# 官方镜像浏览器在 /ms-playwright（默认值，显式声明自证）
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
