FROM node:24-bookworm-slim

RUN corepack enable && corepack prepare pnpm@11.27.0 --activate

WORKDIR /workspace
ENV CI=true
ENV npm_config_store_dir=/pnpm/store
