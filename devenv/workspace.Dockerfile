# PROTOTYPE（#11）— workspace 镜像：代码烘焙进镜像（无 bind mount）。
# 动因：本机运行时是 Rancher Desktop podman machine（独立 WSL 发行版），
# bind mount 的宿主路径会解析进 machine 自身文件系统（静默挂错内容）。
# 代码只经 COPY 入镜像 → "宿主机只存代码"更彻底；代码变更 = 重新 devenv build（层缓存秒级命中）。

FROM natural-enforcement/tools:prototype1 AS lockgen
WORKDIR /workspace
COPY pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
# 实验（#54）：原型 lockgen 未 COPY 现有 lockfile → 每次全量重解析（caret 漂移、慢）。
# 本实验为隔离“缓存复用”变量，让 lockgen 基于现有 lockfile 增量解析；首引导场景仍需另行处理。
COPY pnpm-lock.yaml ./
COPY devenv/exp/summarize-pnpm.mjs /opt/exp/summarize-pnpm.mjs
# 候选（#54）：registry 元数据（packument）缓存走引擎原生 cache mount——lockgen 的耗时是元数据往返，
# 不是包内容下载（实测 A3：0 个包下载、331s）。--prefer-offline：已缓存的元数据不再联网复验；
# catalog 一律精确 pin，解析结果由 lockfile + 精确版本决定，不依赖元数据新鲜度。
ARG PNPM_META_CACHE_ID=ne-pnpm-meta-v12
# @gen:pkg-copy
RUN --mount=type=cache,id=${PNPM_META_CACHE_ID},target=/root/.cache/pnpm,sharing=locked \
    bash -o pipefail -c 'pnpm install --lockfile-only --prefer-offline --reporter=ndjson 2>&1 | tee /tmp/pnpm-lockgen.ndjson | node /opt/exp/summarize-pnpm.mjs lockgen'

# deps 靶：依赖已装、源码已入、未构建——调试/工具用（docker build --target deps）
# 注意：COPY 一律取自构建上下文（lockfile 已由 devenv 经 lockgen 导出并提交），
# 换 COPY --from 来源会改变层缓存链导致 install 全量重跑（实测 #11）。
FROM natural-enforcement/tools:prototype1 AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
COPY devenv/exp/summarize-pnpm.mjs /opt/exp/summarize-pnpm.mjs
# 候选（#54）：pnpm 内容寻址 store 走引擎原生 cache mount，跨构建、跨 worktree 复用。
# - sharing=locked：并发构建串行使用 store（实测 P3：A 476→488 结束，B 489 才开始）
# - 重建 deps 层（新增包/lockfile 变化）时 store 命中，只下载新增内容
# - store 是缓存不是信任根：实测 pnpm 12.21 对被篡改的 store 文件静默导入、pnpm store status 也不报
#   （P2/P5）。需要干净重建时换 id：--build-arg PNPM_STORE_CACHE_ID=<新 id>（P4 实测空 store）
# - store 不再随镜像层落盘：镜像体积不含 ~745MB store
ARG PNPM_STORE_CACHE_ID=ne-pnpm-store-v11
# @gen:pkg-copy
RUN --mount=type=cache,id=${PNPM_STORE_CACHE_ID},target=/pnpm/store,sharing=locked \
    bash -o pipefail -c 'pnpm install --frozen-lockfile --store-dir=/pnpm/store --reporter=ndjson 2>&1 | tee /tmp/pnpm-install.ndjson | node /opt/exp/summarize-pnpm.mjs deps'
COPY . .

# 终靶：构建产物入镜像
FROM deps AS workspace
RUN pnpm exec turbo run build
