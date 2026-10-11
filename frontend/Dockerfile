# 前端本地镜像（#56 切片09）：多阶段构建——钉定 node 工具链镜像内编译（产物同时由
# dev build 写回宿主并 gitignore），钉定 nginx 镜像运行静态产物。
# 基础镜像唯一依据 infra/VERSIONS.md（官方名 + digest，严禁 latest）；
# 镜像由 dev build 构建（compose 只按 image 引用 + pull_policy never，缺失走先 dev build 契约）。
# 不写 # syntax=docker/dockerfile:1 指令：其会去 docker.io 拉取 frontend 镜像，
# 境内宿主不可达；内建 frontend 已支持下方 RUN --mount=type=cache。
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /work
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY . /work
# 安装旗标与 dev 脚本工具链一致（--ignore-scripts + strict-dep-builds=false：
# 被拦构建脚本在 pnpm 12 冻结锁下默认报 ERR_PNPM_IGNORED_BUILDS）；
# corepack/pnpm 缓存用 buildkit cache mount 持久化，加速重复构建。
RUN --mount=type=cache,target=/root/.cache/node/corepack \
    --mount=type=cache,target=/root/.cache/pnpm \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable \
    && pnpm install --frozen-lockfile --ignore-scripts --config.strict-dep-builds=false \
    && pnpm --filter frontend build

FROM nginx:1.29.8@sha256:1881968aff6f7cdcc4b888c00a11f4ce241ad7ec957e0cb4a9e19e93a3ff87ea
COPY --from=build /work/frontend/dist /usr/share/nginx/html
# /usr/share/nginx/html/health 由 compose 挂命名卷（快照端点 /health/health.json），此处不 COPY
