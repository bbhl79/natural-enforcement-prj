# 实验（#54）离线证明靶：与候选 deps 靶相同的清单 + store cache，但 --network=none + pnpm --offline。
# 构建成功 ⇒ lockfile 所需的全部包内容都已在本地 store 中（零网络下载的行为证据）。
FROM natural-enforcement/tools:prototype1 AS deps
WORKDIR /workspace
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/tsconfig packages/tsconfig
COPY devenv/exp/summarize-pnpm.mjs /opt/exp/summarize-pnpm.mjs
RUN --mount=type=cache,id=ne-pnpm-exp-20261124-v11,target=/pnpm/store,sharing=locked \
    bash -o pipefail -c 'pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store --reporter=ndjson 2>&1 | tee /tmp/pnpm-offline.ndjson | node /opt/exp/summarize-pnpm.mjs'