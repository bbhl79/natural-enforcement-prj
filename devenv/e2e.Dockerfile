# e2e 执行器镜像（#70）：官方 Playwright 镜像 + 项目 e2e 运行时。
#
# 无 bind 架构（Spec-工程基座 硬不变量 3）：e2e 代码/配置/测试全部 COPY 入镜像；
# 构建上下文 = devenv 采集的固定输入快照（#58），构建期不读取活工作树。
# 浏览器/系统依赖零自管：基座 tag 与 npm 包 @playwright/test 版本严格一致——
# 静态门禁（devenv/lib/supply-chain.sh）交叉核对 catalog 与 images.lock，
# 本 Dockerfile 再在安装后核对实际安装版本，任何不一致都停止构建。
ARG PLAYWRIGHT_IMAGE
FROM ${PLAYWRIGHT_IMAGE}

ARG PLAYWRIGHT_IMAGE
ARG PLAYWRIGHT_VERSION

# 身份标签：devenv 复用既镜像前核对（tag+digest 双层锁值 + 包版本）
LABEL devenv.playwright.image="${PLAYWRIGHT_IMAGE}"
LABEL devenv.playwright.version="${PLAYWRIGHT_VERSION}"

# Node 26 起官方镜像不捆绑 corepack（与 tools.Dockerfile 同决策）
RUN npm install -g pnpm@12.21.0

WORKDIR /workspace
# manifest 层（与 workspace.Dockerfile 同款显式清单：新 workspace 包必须进清单）
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig

# 供应链门禁（#63）：install 后核对待审批的构建脚本/包内 agent skills（默认拒绝）。
COPY devenv/supply-chain/check-permissions.sh /usr/local/bin/ne-check-permissions
RUN chmod +x /usr/local/bin/ne-check-permissions

# 只装 e2e 闭包依赖；store/元数据走引擎原生 cache mount（复用 workspace 的 cache id）。
ARG PNPM_STORE_CACHE_ID=ne-pnpm-store-v11
ARG PNPM_META_CACHE_ID=ne-pnpm-meta-v12
RUN --mount=type=cache,id=${PNPM_STORE_CACHE_ID},target=/pnpm/store,sharing=locked \
    --mount=type=cache,id=${PNPM_META_CACHE_ID},target=/root/.cache/pnpm,sharing=locked \
    pnpm install --frozen-lockfile --filter @ne/e2e... --store-dir=/pnpm/store \
    && ne-check-permissions

# 源码层：e2e 包 + 契约包（测试在运行时消费契约常量/类型）
COPY packages/contracts packages/contracts
COPY apps/e2e apps/e2e
RUN pnpm --filter @ne/contracts run build

# 严格同版本：镜像 tag 的版本 == 实际安装的 @playwright/test 版本（不一致即停止构建）
RUN node -e "const p=require('/workspace/apps/e2e/node_modules/@playwright/test/package.json'); if(p.version!==process.env.PLAYWRIGHT_VERSION){console.error('Playwright 版本不一致：npm='+p.version+' 镜像='+process.env.PLAYWRIGHT_VERSION); process.exit(1)} console.log('playwright='+p.version+'（与镜像 tag 一致）')"

# 官方镜像浏览器在 /ms-playwright（默认值，显式声明自证）
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright