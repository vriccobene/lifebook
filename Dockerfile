# syntax=docker/dockerfile:1
# Two runnable targets: `api` (Fastify + SQLite) and `web` (nginx serving the built SPA).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
# Fallback toolchain in case better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/lifebook-api/package.json apps/lifebook-api/
COPY apps/lifebook-web/package.json apps/lifebook-web/
COPY packages/lifebook-core/package.json packages/lifebook-core/

# ---- API ----
FROM base AS api-build
# `prepare` sets a git hook path: not needed (and no git) in the image.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @lifebook/api... \
  && pnpm rebuild better-sqlite3
COPY packages/lifebook-core packages/lifebook-core
COPY apps/lifebook-api apps/lifebook-api

FROM node:22-bookworm-slim AS api
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production \
  HOST=0.0.0.0 PORT=3000 LIFEBOOK_DB=/data/lifebook.sqlite
RUN corepack enable && mkdir -p /data /backups && chown node:node /data /backups
WORKDIR /app
COPY --from=api-build --chown=node:node /app /app
USER node
WORKDIR /app/apps/lifebook-api
VOLUME ["/data", "/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["pnpm", "start"]

# ---- Web ----
FROM base AS web-build
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @lifebook/web...
COPY packages/lifebook-core packages/lifebook-core
COPY apps/lifebook-web apps/lifebook-web
RUN pnpm --filter @lifebook/web exec vite build

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/lifebook-web/dist /usr/share/nginx/html
EXPOSE 80
