# workspace 镜像：代码烘焙进镜像（无 bind mount，Spec-工程基座 硬不变量 3）。
# 动因：开发机运行时是 podman machine（独立虚拟机），bind mount 的宿主路径会
# 解析进 machine 自身文件系统（静默挂错内容，原型 #11 实测）；代码只经 COPY
# 入镜像 → 架构不依赖各虚拟机文件共享实现。构建上下文 = devenv 采集的固定
# 输入快照（#58，lib/snapshot.sh），构建期不读取活工作树。
#
# 分层：manifest 层（显式 COPY 各包 package.json）→ deps 层（pnpm install
# --frozen-lockfile）→ 源码层（turbo build）。新增 workspace 包必须同步
# lockgen-base 与 deps 两靶的 manifest COPY 清单，否则 lockfile 解析不到该包
# （静默）且 deps 靶断。
#
# deps 层缓存（#54 结论采纳）：pnpm 内容寻址 store 走引擎原生 cache mount，
# 跨构建、跨 worktree 复用——新增包/lockfile 变化重建 deps 层时，未变更依赖
# 包内容命中本地 store、零网络下载（#54 B4/B6/B7 实测）；普通构建保持
# --frozen-lockfile。store 是缓存不是信任根（#54 §六.1）：需要干净重建时换
# cache id（--build-arg PNPM_STORE_CACHE_ID=<新 id>）。

# lockgen 公共靶：manifest 层（lockfile 可选——首引导无 lockfile 走 lockgen-fresh）
FROM natural-enforcement/tools:local AS lockgen-base
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig

# registry 元数据（packument）缓存走引擎原生 cache mount：lockgen 的耗时是元数据
# 往返，不是包内容下载（#54 A3 实测：0 包下载、331s 全在元数据）。--prefer-offline：
# 已缓存元数据不再联网复验；catalog 一律精确 pin，解析结果由 lockfile + 精确版本
# 决定，不依赖元数据新鲜度。
ARG PNPM_META_CACHE_ID=ne-pnpm-meta-v12

# lockgen 靶（有既有 lockfile：增量解析，#54 B3 口径 128s vs 全量 331s）
FROM lockgen-base AS lockgen
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=${PNPM_META_CACHE_ID},target=/root/.cache/pnpm,sharing=locked \
    pnpm install --lockfile-only --prefer-offline

# lockgen-fresh 靶（首引导无 lockfile：全量解析；#54 §六.2 实施期处理）
FROM lockgen-base AS lockgen-fresh
RUN --mount=type=cache,id=${PNPM_META_CACHE_ID},target=/root/.cache/pnpm,sharing=locked \
    pnpm install --lockfile-only --prefer-offline

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
ARG PNPM_STORE_CACHE_ID=ne-pnpm-store-v11
RUN --mount=type=cache,id=${PNPM_STORE_CACHE_ID},target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY . .

# 终靶：构建产物入镜像
FROM deps AS workspace
RUN pnpm exec turbo run build
