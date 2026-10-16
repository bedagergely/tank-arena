# syntax=docker/dockerfile:1

# ---- build: install workspace, build client + server ----
FROM oven/bun:1.4.3 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---- runtime: Bun only, production deps ----
FROM oven/bun:1.4.3
ENV NODE_ENV=production PORT=2567
WORKDIR /app

# Only the server workspace is needed at runtime: its bundle inlines `@tank-arena/shared`,
# and the client is prebuilt into `apps/client/dist`. The client's prod deps are not installed.
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --production

COPY --from=build /app/apps/server/build apps/server/build
COPY --from=build /app/apps/client/dist apps/client/dist

USER bun
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD bun -e "fetch('http://127.0.0.1:2567/__healthcheck').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "apps/server/build/index.js"]
