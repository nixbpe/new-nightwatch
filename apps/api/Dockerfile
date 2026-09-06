# syntax=docker/dockerfile:1
# Production image for @nightwatch/api (Hono on Bun).
# Build context MUST be the repo root (the monorepo lockfile and workspace
# manifests live there):
#   docker build -f apps/api/Dockerfile -t nightwatch-api .

# ---------------------------------------------------------------------------
# Stage 1: deps — install the full workspace from the frozen lockfile.
# Only manifests + lockfile are copied so source changes never bust this
# layer's cache.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: build — compile the API to a single self-contained bundle.
# `bun build --target bun` inlines every dependency (hono, zod, pino, the
# @nightwatch/* workspace sources and apps/api/package.json), so the runtime
# stage needs nothing but dist/index.js.
FROM deps AS build
WORKDIR /app
COPY packages packages
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
RUN bun run build && test -f dist/index.js

# ---------------------------------------------------------------------------
# Stage 3: runtime — minimal, non-root, no source, no node_modules.
# Verified: dist/index.js is self-contained (no top-level imports; every
# workspace + npm dependency is inlined at build time), so no production
# install or workspace sources are copied. No .env or secrets enter any
# stage; configuration arrives via runtime environment variables
# (PORT, LOG_LEVEL, NODE_ENV — see packages/shared/src/env.ts).
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.2-alpine AS runtime
WORKDIR /app
# Apply pending Alpine security fixes (openssl/musl/zlib in the pinned base
# image carry HIGH/CRITICAL CVEs; the trivy gate requires zero).
RUN apk update && apk upgrade --no-cache \
  && addgroup -S nightwatch -g 1001 \
  && adduser -S nightwatch -u 1001 -G nightwatch
COPY --from=build --chown=1001:1001 /app/apps/api/dist ./dist
USER 1001
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/health || exit 1
CMD ["bun", "dist/index.js"]
