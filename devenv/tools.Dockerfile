# 工具/应用基座镜像。基座引用由 devenv/images.lock 的 NODE_IMAGE 行经
# --build-arg 注入（tag+digest 双层锁的唯一事实源在锁文件，不在本文件写死）。
# Node 26 起官方镜像不再捆绑 corepack（TSC 决议：自 Node 25 起移除），故用 npm 全局装 pnpm。
ARG NODE_IMAGE=node:26.13.1-slim
FROM ${NODE_IMAGE}

RUN npm install -g pnpm@12.21.0

# 运行身份与卷挂载点由 compose 注入（pnpm store 随镜像层落盘；deps 层缓存
# 优化结论的采纳归 #58）
WORKDIR /workspace
