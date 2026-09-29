# syntax=docker/dockerfile:1
# Production image for @nightwatch/worker (BullMQ roles on Bun).
# Build context MUST be the repo root (the monorepo lockfile and workspace
# manifests live there):
#   docker build -f apps/worker/Dockerfile -t nightwatch-worker .

# ---------------------------------------------------------------------------
# Stage 1: deps: install the full workspace from the frozen lockfile.
# Only manifests + lockfile are copied so source changes never bust this
# layer's cache.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/db/package.json packages/db/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/shared/package.json packages/shared/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: build: bundle the Worker into one file for the Bun runtime.
# Every dependency (bullmq, pg, zod, pino, @nightwatch/*) is inlined; only
# node builtins remain as imports.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY packages packages
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
ENV NODE_ENV=production
RUN bun run build && test -f dist/index.js

# ---------------------------------------------------------------------------
# Stage 3: runtime: minimal, non-root, no source, no node_modules.
# The runtime is Bun 1.3.14, the version the SSRF helper (node:tls path) was
# validated on; never run this bundle on Node. No .env or secrets enter any
# stage; configuration arrives via runtime environment variables.
#
# Required at container start:
#   WORKER_ROLES                    comma list of consumer, scheduler,
#                                   monitor-scheduler, monitor-checker
#                                   (unset means consumer)
#   DATABASE_URL                    runtime DB role (non-owner, NOBYPASSRLS)
#   REDIS_URL                       non-cluster Redis
#   CREDENTIAL_ENCRYPTION_KEYS      monitor roles, production only
#   CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION
# Optional: LOG_LEVEL, MONITOR_EGRESS_CANARY_URLS.
# OUTBOUND_TEST_ALLOWED_HOSTS is refused by the Worker when NODE_ENV=production
# and is never set here.
#
# The Worker exposes no HTTP endpoint, so the image has no HEALTHCHECK.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime
WORKDIR /app
# The base digest freezes Bun and the initial filesystem. Security fixes are
# explicit reviewed package pins: no rolling `apk update`/`apk upgrade`.
RUN apk add --no-cache \
      'libcrypto3=3.5.8-r0' \
      'libssl3=3.5.8-r0' \
      'musl=1.2.5-r12' \
      'musl-utils=1.2.5-r12' \
      'zlib=1.3.2-r0' \
  && addgroup -S nightwatch -g 1001 \
  && adduser -S nightwatch -u 1001 -G nightwatch
COPY --from=build --chown=1001:1001 /app/apps/worker/dist ./dist
# A missing NODE_ENV makes the Worker treat the container as development: it
# would accept the public development credential key and
# OUTBOUND_TEST_ALLOWED_HOSTS. The entrypoint refuses to start in that case.
COPY --chmod=0555 <<'SH' /usr/local/bin/worker-entrypoint.sh
#!/bin/sh
set -eu
case "${NODE_ENV:-}" in
  production | development) ;;
  "")
    echo "nightwatch-worker: NODE_ENV is unset; refusing to start. Set NODE_ENV=production." >&2
    exit 78
    ;;
  *)
    echo "nightwatch-worker: NODE_ENV must be production (or development for local compose); refusing to start." >&2
    exit 78
    ;;
esac
exec bun dist/index.js
SH
USER 1001
ENV NODE_ENV=production \
    LOG_LEVEL=info
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/worker-entrypoint.sh"]
