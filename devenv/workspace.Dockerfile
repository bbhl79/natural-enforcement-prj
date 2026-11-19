# PROTOTYPE（#11）— workspace 镜像：代码烘焙进镜像（无 bind mount）。
# 动因：本机运行时是 Rancher Desktop podman machine（独立 WSL 发行版），
# bind mount 的宿主路径会解析进 machine 自身文件系统（静默挂错内容）。
# 代码只经 COPY 入镜像 → "宿主机只存代码"更彻底；代码变更 = 重新 devenv build（层缓存秒级命中）。

FROM natural-enforcement/tools:prototype1

# ---- lockgen：仅生成 lockfile（devenv build 首次引导用；--lockfile-only 不拉包） ----
FROM natural-enforcement/tools:prototype1 AS lockgen
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
RUN pnpm install --lockfile-only

# ---- 主阶段 ----
FROM natural-enforcement/tools:prototype1 AS workspace
WORKDIR /workspace
# 依赖层：仅在 lockfile/清单变化时失效
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
RUN pnpm install --frozen-lockfile
# 源码层：任意源码变更只重建此层（prisma generate + turbo build）
COPY . .
RUN pnpm exec turbo run build
