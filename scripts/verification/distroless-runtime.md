# Distroless runtime verification

Run these commands from the repository root. Docker, Bun, Node, and OpenSSL must be available. The verification script requires built images and refuses missing image variables. It does not build or pull images.

```sh
docker build -f apps/api/Dockerfile -t nightwatch-api:distroless-proof .
docker build -f apps/worker/Dockerfile -t nightwatch-worker:distroless-proof .
docker build -f apps/worker/Dockerfile \
  --build-arg WORKER_ALLOW_DEVELOPMENT=1 \
  -t nightwatch-worker:distroless-dev-proof .
docker pull postgres:17.11-alpine
docker pull redis:7.4.7-alpine
docker pull axllent/mailpit:v1.31.1

DISTROLESS_API_IMAGE=nightwatch-api:distroless-proof \
DISTROLESS_WORKER_IMAGE=nightwatch-worker:distroless-proof \
DISTROLESS_WORKER_DEV_IMAGE=nightwatch-worker:distroless-dev-proof \
bun test scripts/verification/distroless-runtime.test.mjs

bun test scripts/quality/worker-container-entrypoint.test.mjs
```

The script owns an internal Docker network and containers named with a fresh `nw-distroless-<uuid>` prefix. It publishes no host ports and does not use ambient Compose services or credentials. PostgreSQL bootstraps the normal owner and runtime roles through `scripts/db/init/001-roles.sh`. Owner credentials enter only the database fixture and migration job. API and Worker receive only the least-privilege runtime database URL.

Temporary environment files use mode `0600` inside a private temporary directory. The generated TLS fixture key and certificate use read-only mounts. Their files are readable by the container UID, while the enclosing host directory remains private. The script removes its containers, network, and temporary files after completion or handled interruption.

## Covered behavior

- Bun `1.4.3`, numeric UID/GID `1001:1001`, and absent shell/package-manager/download tools in all three images.
- Production and development build markers, with denied writes to the marker and launcher paths.
- Production rejection of empty, development, and test environments, including a runtime development-flavor spoof.
- Development rejection of empty and test environments, and successful development startup without production encryption keys.
- Application startup after the production guard, and refusal of missing production encryption keys.
- API command override and real migration replay against a fresh PostgreSQL cluster.
- API healthcheck success, HTTP `503` failure, and connection-error failure without a shell.
- Real SMTP verification during API startup and an invalid-credential authentication request through the runtime database role.
- TLS client acceptance with an explicit fixture CA and rejection of the same certificate without that CA, on both API and Worker images.
- All five Worker roles reaching readiness, ignoring extra command arguments, and stopping through the existing SIGTERM handlers within 30 seconds.

Worker shutdown is checked with idle queues. These checks do not prove drain behavior for every in-flight job. The application shutdown implementation and its existing tests are unchanged.

## Image policy

Builder stages use `oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288`. Runtime stages use `oven/bun:1.4.3-distroless@sha256:1aaa515018b0b37d95dbdebd55d1b7f37ad258a6289ba63e4bc3b9c9e3038697`. Both use Debian/glibc. Bun, application dependencies, lockfiles, and install-script policy remain unchanged.

The API clears the upstream entrypoint to preserve command overrides such as `bun dist-migrate/migrate.js`. Its default command and healthcheck disable Bun auto-install. The Worker runs a separate root-owned `0444` launcher with `--no-install`, validates the live environment, and imports the bundle in the same process. The development marker is created only by the validated build argument and remains root-owned.

The first container verification exposed a Worker startup `EACCES` error. Running the same launcher with `--no-install` reached the expected missing-configuration error instead. Runtime package fetching is now disabled rather than granting writable application directories. The initial verification also recorded an API exec exit `137`; its cause was not independently established. Subsequent complete verification passed after the startup flags changed.

## Observed local evidence

The local Linux/arm64 images built successfully for API, production Worker, and development Worker. The runtime suite passed 14 tests, including actual migration, health, TLS, startup-policy, and SIGTERM probes. The launcher unit suite passed 8 tests. Raw local logs are under `/tmp/nightwatch-distroless` on the author machine.

Trivy scans of both final production images reported no HIGH or CRITICAL vulnerability or secret findings at verification time. These scans do not establish the absence of vulnerabilities in bundled application dependencies. The package-manager audit remains a separate release gate.

Baseline images were rebuilt from the pre-change Dockerfiles at `4a26c3b` with the same workspace source and lockfile. Local logical image sizes increased by about 15 MB per image after switching from Alpine/musl to distroless/glibc. Distroless removes runtime tools here; it does not establish a smaller image, lower RAM, or faster execution. Compressed pull size and runtime resource performance were not measured.

Native Linux/amd64 execution and GitHub CI were not run locally. The pinned official image manifests advertise both amd64 and arm64. This verification does not run the complete application integration/browser suites and does not authorize publishing or deploying images. The development image must never be deployed.
