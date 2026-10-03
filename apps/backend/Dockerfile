FROM node:24-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.27.0 --activate

WORKDIR /workspace
ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @gzgt/backend...

COPY apps/backend apps/backend
RUN pnpm --filter @gzgt/backend build \
  && pnpm --filter @gzgt/backend deploy --prod /opt/app \
  && cp -a apps/backend/dist /opt/app/dist

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /opt/app ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
