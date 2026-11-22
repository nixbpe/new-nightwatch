# Uptime monitor operations

Scope: F-005 monitor credentials, Worker roles and result partitions. Commands
run against the environment named by the exported variables; production changes
need the user's approval for that target.

## Environment

| Variable | Rule |
| --- | --- |
| `CREDENTIAL_ENCRYPTION_KEYS` | JSON map of key version to base64 of 32 random bytes. Required in production. |
| `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION` | Version used for new encryption. Must exist in the map. |
| `REDIS_URL` | Required by API and Worker. |
| `MONITOR_EGRESS_CANARY_URLS` | Optional, comma-separated http(s) URLs. Unset means canary result is "unknown". Prefer https URLs: an http canary behind a transparent proxy that answers 403 reads as reachable. |
| `OUTBOUND_TEST_ALLOWED_HOSTS` | Optional, hostnames only, CI and e2e. CI uses `target.nw-test.internal`, mapped to 127.0.0.1 in `/etc/hosts`, because the SSRF helper blocks `localhost`. Never set in production (startup fails). |

Generate a key: `openssl rand -base64 32`. Store it in the approved secret
store, never in the repo or logs. Production refuses version `dev` and the
public development key.

## Rotate a credential key

1. Generate a new key and add it to `CREDENTIAL_ENCRYPTION_KEYS` under a new
   version (for example `2026-10`), keeping every existing version.
2. Set `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION` to the new version.
3. Roll out API and Worker together with the same map. New and edited secrets
   use the new version. Existing rows still decrypt because each row stores its
   `key_version`.
4. Check what still uses old versions (owner connection):
   `select key_version, count(*) from monitor_secrets group by 1;`
5. Remove an old version from the map only when its count is 0. Removing a
   version that rows still reference is intended to make those checks report a
   decrypt error (intended behaviour, not yet exercised).
   Rows move to the new version when the owner re-enters the credential; no bulk
   re-encryption tool exists in F-005.

A leaked key: rotate as above. Owners then rotate the credentials at the target
system and re-enter the values in NightWatch, since old ciphertext stays
readable with the old key until it is removed from the map.

## Run the Worker roles

Set `WORKER_ROLES` to the comma-separated roles assigned to this process.
Find supported roles through the [Worker runtime code index](../features.md#toolchain-และ-ci).

- Worker containers must run with `NODE_ENV=production` so the key rules and the
  `OUTBOUND_TEST_ALLOWED_HOSTS` ban apply. The Worker process itself treats a
  missing `NODE_ENV` as development; the image entrypoint prevents that (see
  Worker image).
- Egress canary: a wrong `MONITOR_EGRESS_CANARY_URLS` entry (does not resolve or
  points at a forbidden address) is cached as failed, so every network-level
  failure becomes `check_error` and no incident or DOWN alert opens. Verify the
  canary URLs resolve from the Worker network before release.
- Run at least one `monitor-scheduler` and one `monitor-checker`. Each role
  supports multiple instances.
- For in-app notifications, run `scheduler` and `consumer`.
- For audit exports and audit retention, run `audit-exporter`.
- For the removal of inventory import previews (F-022, S7.3), run `inventory-maintenance`. Every minute it
  deletes previews past their 30 minutes, whether or not anyone opens the page. It needs only
  `DATABASE_URL` (and `REDIS_URL`, which every role requires), and several instances are safe because
  the deletion is idempotent. Without it an expired preview is still refused on confirm and hidden from
  its owner, but its parsed rows stay in the database.
- For the scheduled CVE scan (F-020), run `vulnerability-scanner`. It claims a due Project from
  PostgreSQL, scans it every 12 hours (retries after 1 hour when a scan does not finish) and spends
  from the same NVD limit as the API through Redis with the same `REDIS_KEY_PREFIX`. Run one
  instance per NVD egress address; more instances share the limit and add no throughput. A lease
  lasts 30 minutes, after which another instance continues the run.
- For the new-CVE mail (F-020, S4.3), run `notification-email`. It needs `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (required) and `APP_URL` (the origin of
  the links), and refuses to start when the SMTP server cannot be verified. A mail is sent at most
  once per claim, so a Worker that stops between SMTP acceptance and the end of the claim sends it
  again after the 5 minute lease. A failed send is retried after 5 minutes times the attempts, up to
  5 attempts (an outage of about an hour makes the last attempt fail and the mail is dropped; the
  in-app notification stays and the log says so). Interrupted fifth attempts are marked failed
  after lease expiry and logged as a count without recipient data on the next email round.
  Each round also removes up to 100 expired email jobs, sharing that limit with failed-lease
  recovery and preserving live send leases. This cleanup does not purge the parent intents. Each recipient is checked again when the mail is
  sent. A send that does not end in 2 minutes is abandoned and retried; if the SMTP server accepts it later, that recipient gets one extra mail. The role refuses to start when SMTP cannot be verified and that ends the whole process, so run
  it in its own service, as `compose.worker.yaml` does.
- After [local dependency setup](../../scripts/quality/README.md#local-development-dependencies-postgresql--mailpit--redis),
  run `bun run dev` for local development.
- To stop the Worker, send SIGTERM. The scheduler stops before the checker.

### Worker image

`apps/worker/Dockerfile` builds `nightwatch-worker` from the repo root:
`docker build -f apps/worker/Dockerfile -t nightwatch-worker .`

- API and Worker use the digest-pinned `oven/bun:1.4.3-slim` builder and
  `oven/bun:1.4.3-distroless` runtime (Debian/glibc), with numeric runtime user
  `1001:1001` (uid/gid). The runtime has no shell, `id`, `wget` or package
  manager. The SSRF helper was validated on Bun 1.4.3; do not run the bundle
  on Node.
- The image sets `NODE_ENV=production` and its entrypoint exits 78 with a message
  unless `NODE_ENV` is exactly `production`, so unset, empty, `development` and
  `test` are refused. It carries no keys, no secrets and no
  `OUTBOUND_TEST_ALLOWED_HOSTS`. Only a build with
  `--build-arg WORKER_ALLOW_DEVELOPMENT=1` (local compose, tag
  `nightwatch-worker:dev`) also accepts `development`; that choice is a marker
  file written at build time and cannot be set through run-time env.
  The root-owned, read-only Bun launcher checks the live environment before
  importing the bundle in the same process; it does not spawn a child.
  Default API/Worker startup and the API healthcheck use `--no-install` so Bun
  cannot fetch missing runtime packages. Required dependencies remain bundled.
- The entrypoint ignores its arguments: `docker run nightwatch-worker id -u`
  starts the Worker. Run other commands with `--entrypoint`, for example
  `docker run --rm --entrypoint /usr/local/bin/bun nightwatch-worker -e 'console.log(process.getuid())'`
  (prints 1001).
- Check that the Worker process is running. The image has no `HEALTHCHECK` or
  health endpoint. Confirm startup for the configured roles using their startup
  messages. Find the current messages through the
  [Worker runtime code index](../features.md#toolchain-และ-ci).
  A startup message does not prove continuing health.
- Set at run time: `WORKER_ROLES`, `DATABASE_URL`, `REDIS_URL`,
  `CREDENTIAL_ENCRYPTION_KEYS`, `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION`.
  Run one container per role (`monitor-scheduler`, `monitor-checker`) so each
  scales and stops on its own. On SIGTERM the scheduler stops first, running
  checks drain for up to 15 s (then their requests are aborted) and a hard
  deadline exits the process at 25 s. Set a stop grace period of at least 30 s
  and run with `--init` (or tini): the Worker registers its SIGTERM handler
  after start, so without an init process a stop during startup waits out the
  full grace period.
- Production example (values come from the secret store):
  `docker run --rm --init -e WORKER_ROLES=monitor-checker -e DATABASE_URL -e REDIS_URL -e CREDENTIAL_ENCRYPTION_KEYS -e CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION nightwatch-worker`
  Without the two credential variables the Worker exits with
  `CREDENTIAL_ENCRYPTION_KEYS is required in production`.

Local compose: `compose.worker.yaml` adds `monitor-scheduler` and
`monitor-checker` to the dev stack (usage in its header; same project and
`NW_SLOT` as `compose.yaml`). It builds the ARG-gated `nightwatch-worker:dev`
image and sets `NODE_ENV=development`, so the Worker falls back to its public dev
credential key (version `dev`). A production artifact cannot run with
`NODE_ENV=development`, and with `NODE_ENV=production` the Worker rejects
version `dev` and the public key. Never deploy the `:dev` image or reuse that
file outside local development.

Deployment dependencies before release (not part of this image):

- Redis must be non-cluster. API rate-limit keys hash to different slots, so
  their `EVAL` fails with `CROSSSLOT` on a cluster.
- Network egress control of the production Worker network is a separate
  dependency in the F-005 spec. The image does not restrict outbound traffic;
  the SSRF helper is the only guard until that control exists.

## Partitions

`bun run db:partitions` after every `db:migrate` and at least monthly (see
`scripts/quality/README.md`). The scheduler logs a
warning when fewer than 2 months ahead exist. On a `lock timeout` exit nothing
changed: rerun at low traffic with a short timeout (default 5000 ms, max 30000
ms). Do not raise the timeout to wait out a long lock. Creating or dropping a
partition is inferred to lock the parent table.

## Project-scoped monitors (F-011)

Migration `0026_project_monitors.sql` deletes all existing monitor data and
does not move it into a Project (AC-08): it truncates `monitors` and the seven
tables that reference it, and deletes the `MONITOR_*` notification intents with
their recipients, inbox items and dispatch ledger rows. `audit_events` is
untouched. Confirm that the target environment holds no monitor data to keep
before `bun run db:migrate`; the deletion cannot be undone from the migration.

- A monitor belongs to one Project. Deleting a Project removes its monitors,
  results, rollups, incidents, events, secrets, last responses and schedule rows
  through the foreign key cascade. A check or result still in flight for a
  deleted monitor finds no row and is discarded.
- The limit is 20 monitors per Project. There is no Organization cap.
- Down, recovered and SSL notifications go to the Project members and the
  Organization Owners and Admins, once each. A BullMQ materialize job queued for
  a deleted `MONITOR_*` dispatch fails with `notification dispatch claim is
  unavailable`; it needs no action.

### Rollout order

Deploy the API, the Worker and migration `0026` together, or stop the old API
and Worker before the migration. After `0026`, an old API or Worker fails every
monitor insert (`monitors.project_id` is `not null`) and every `MONITOR_*`
notification intent insert (`subject_project_id` is required), so old and new
versions must not run side by side.
