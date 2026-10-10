# syntax=docker/dockerfile:1
# Production image for @nightwatch/api (Hono on Bun).
# Build context MUST be the repo root (the monorepo lockfile and workspace
# manifests live there):
#   docker build -f apps/api/Dockerfile -t nightwatch-api .

# Copy manifests and lockfile only so source changes preserve the dependency cache.
FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS deps
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

# `bun build --target bun` inlines dependencies, including workspace sources.
FROM deps AS build
WORKDIR /app
COPY packages packages
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
RUN bun run build && test -f dist/index.js
# Standalone migration runner for owner-role pre-deploy jobs: dependency
# complete (node builtins + bundled pg), no workspace sources needed at runtime.
WORKDIR /app/packages/db
RUN bun run build:migrate && test -f dist-migrate/migrate.js

# Runtime needs no production install or workspace sources.
# No .env or secrets enter any stage; configuration arrives via runtime environment variables.
#
# Required at container start (the API fails fast without them):
#   DATABASE_URL          runtime DB role (non-owner, NOBYPASSRLS)
#   BETTER_AUTH_SECRET    >= 32 chars, per environment
#   APP_URL               public SPA origin
#   BETTER_AUTH_URL       public API origin (Better Auth trusted origins)
#   CORS_ORIGIN           exact SPA origin, must equal APP_URL
#   SMTP_HOST/PORT/SECURE/FROM (+ paired SMTP_USER/SMTP_PASSWORD)
#                         real SMTP — no fallback sender exists
# DATABASE_OWNER_URL is set only on migration/provisioning jobs
# (owner-before-app rule); the app runtime never receives owner credentials.
# PORT and LOG_LEVEL keep their defaults below.
# ---------------------------------------------------------------------------
FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS runtime
WORKDIR /app
# The base digest freezes Bun and the initial filesystem. Security fixes are
# explicit reviewed package pins: no rolling `apk update`/`apk upgrade`.
RUN apk add --no-cache \
      'libcrypto3=3.5.9-r0' \
      'libssl3=3.5.9-r0' \
      'zlib=1.3.2-r1' \
  && addgroup -S nightwatch -g 1001 \
  && adduser -S nightwatch -u 1001 -G nightwatch
COPY --from=build --chown=1001:1001 /app/apps/api/dist ./dist
# Migration runner for owner-role pre-deploy jobs. Run the same image with
# owner credentials and the migrations directory, e.g.:
#   docker run --rm -e DATABASE_OWNER_URL=postgres://owner:...@db/nightwatch \
#     nightwatch-api bun dist-migrate/migrate.js
# (MIGRATIONS_DIR is pinned below; the app runtime never needs it.)
COPY --from=build --chown=1001:1001 /app/packages/db/dist-migrate ./dist-migrate
COPY --from=build --chown=1001:1001 /app/packages/db/migrations ./migrations
USER 1001
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=4000 \
    MIGRATIONS_DIR=/app/migrations
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4000/health || exit 1
CMD ["bun", "dist/index.js"]