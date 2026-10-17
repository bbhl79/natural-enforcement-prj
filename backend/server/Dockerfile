# HTTP 启动包本地镜像（ADR 0004）。
# 基础镜像唯一依据 infra/VERSIONS.md。compose 只按 image 引用，pull_policy never。
# 进程在容器内监听 3000。该端口不映射到宿主机。
# 不写 # syntax=docker/dockerfile:1：其会去 docker.io 拉取 frontend 镜像，境内宿主不可达。
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /work
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY . /work
RUN --mount=type=cache,target=/root/.cache/node/corepack \
    --mount=type=cache,target=/root/.cache/pnpm \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable \
    && pnpm install --frozen-lockfile --ignore-scripts --config.strict-dep-builds=false \
    && cd backend/prisma \
    && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres pnpm exec prisma generate
EXPOSE 3000
CMD ["node", "--import", "/work/backend/server/register.mjs", "/work/backend/server/src/main.ts"]
