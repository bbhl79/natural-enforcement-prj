# PROTOTYPE（#11）— 工具/应用镜像。
# 基座 digest 由 devenv/images.lock 记录（NODE_IMAGE 行）；此处保留完整 tag 便于人读。
# Node 26 起官方镜像不再捆绑 corepack（TSC 决议：自 Node 25 起移除），故用 npm 全局装 pnpm。
FROM node:26.13.1-slim

RUN npm install -g pnpm@12.21.0

# 运行身份与卷挂载点由 compose 注入（user: 宿主 UID；pnpm store 卷: /pnpm/store）
WORKDIR /workspace
