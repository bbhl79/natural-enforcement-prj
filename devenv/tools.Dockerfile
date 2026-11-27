# 工具/应用基座镜像。基座引用由 devenv/images.lock 的 NODE_IMAGE 行经
# --build-arg 注入（tag+digest 双层锁的唯一事实源在锁文件，不在本文件写死）。
# Node 26 起官方镜像不再捆绑 corepack（TSC 决议：自 Node 25 起移除），故用 npm 全局装 pnpm。
ARG NODE_IMAGE=node:26.13.1-slim
FROM ${NODE_IMAGE}

# 全局 ARG 不自动进入构建阶段；在 stage 内重新声明后 LABEL 才能取到值。
ARG NODE_IMAGE
# 上游 node 镜像身份（tag+digest 双层锁值）：images --verify 经此 label 核对
# tools/workspace 实际基座与 images.lock 的 NODE_IMAGE 一致（#63）。
LABEL devenv.node.image="${NODE_IMAGE}"

RUN npm install -g pnpm@12.21.0

# 运行身份与卷挂载点由 compose 注入（pnpm store 随镜像层落盘；deps 层缓存
# 优化结论的采纳归 #58）
WORKDIR /workspace
