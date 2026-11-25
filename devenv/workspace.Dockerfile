# workspace 镜像：代码烘焙进镜像（无 bind mount，Spec-工程基座 硬不变量 3）。
# 动因：开发机运行时是 podman machine（独立虚拟机），bind mount 的宿主路径会
# 解析进 machine 自身文件系统（静默挂错内容，原型 #11 实测）；代码只经 COPY
# 入镜像 → 架构不依赖各虚拟机文件共享实现。代码变更 = 消费命令前置增量重建
# （层缓存命中时秒级）。
#
# 分层：manifest 层（显式 COPY 各包 package.json）→ deps 层（pnpm install
# --frozen-lockfile）→ 源码层（turbo build）。新增 workspace 包必须同步两靶的
# manifest COPY 清单，否则 lockfile 解析不到该包（静默）且 deps 靶断。

FROM natural-enforcement/tools:local AS lockgen
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
RUN pnpm install --lockfile-only

# deps 靶：依赖已装、源码已入、未构建——调试/工具用（docker build --target deps）
# 注意：COPY 一律取自构建上下文（lockfile 已由 devenv 经 lockgen 导出并提交），
# 换 COPY --from 来源会改变层缓存链导致 install 全量重跑（原型 #11 实测）。
FROM natural-enforcement/tools:local AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
RUN pnpm install --frozen-lockfile
COPY . .

# 终靶：构建产物入镜像
FROM deps AS workspace
RUN pnpm exec turbo run build
