# syntax=docker/dockerfile:1
# Build context: repo root. docker build -f apps/worker/Dockerfile -t stoktok-worker .
FROM node:22-bookworm-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @stoktok/worker build \
    && pnpm --filter @stoktok/worker deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/worker/dist ./dist
COPY --from=build --chown=node:node /repo/apps/worker/package.json ./
USER node
ENTRYPOINT ["node", "dist/cli.js"]
