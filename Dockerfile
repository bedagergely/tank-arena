# syntax=docker/dockerfile:1

# ---- build: install workspace, build client + server, prune server deps ----
FROM node:22-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build \
 && pnpm --filter @tank-arena/server deploy --prod --legacy /out/apps/server \
 && mkdir -p /out/apps/client && cp -r apps/client/dist /out/apps/client/dist

# ---- runtime: Node only, no toolchain ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:2567/__healthcheck').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/build/index.js"]
