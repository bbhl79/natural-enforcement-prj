FROM node:24-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.27.0 --activate

WORKDIR /workspace
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @gzgt/frontend...

COPY apps/frontend apps/frontend
RUN pnpm --filter @gzgt/frontend build

FROM nginx:1.28-alpine

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/frontend/dist /usr/share/nginx/html
