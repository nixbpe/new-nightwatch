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

`WORKER_ROLES` is a comma-separated list. The behaviour below for
`monitor-scheduler` and `monitor-checker`, SIGTERM order and the partition
warning applies after NODE-F005-08S/08 merge; until then `WORKER_ROLES` with
the new roles is rejected as an unknown role. Roles: `consumer`, `scheduler`,
`monitor-scheduler` (claims due checks every 10 s, purges expired data),
`monitor-checker` (runs checks, concurrency 20).

- Worker containers must run with `NODE_ENV=production` so the key rules and the
  `OUTBOUND_TEST_ALLOWED_HOSTS` ban apply. A container without it silently
  accepts the public development key.
- Run at least one `monitor-scheduler` and one `monitor-checker`. Several of
  each are safe: claims use `FOR UPDATE SKIP LOCKED` and job ids are
  deterministic.
- Local dev: the `WORKER_ROLES` in `apps/worker/package.json` is changed by
  NODE-F005-08; after that merge the full list is
  `consumer,scheduler,monitor-scheduler,monitor-checker`.
- Stop with SIGTERM; the scheduler stops before the checker.

### Worker image

`apps/worker/Dockerfile` builds `nightwatch-worker` from the repo root:
`docker build -f apps/worker/Dockerfile -t nightwatch-worker .`

- Runtime is `oven/bun:1.3.14-alpine` (same digest as the API image), user
  `nightwatch` (uid 1001). The SSRF helper was validated on Bun 1.3.14; do not
  run the bundle on Node.
- The image sets `NODE_ENV=production` and its entrypoint exits 78 with a message
  when `NODE_ENV` is unset, empty or not `production`/`development`. It carries
  no keys, no secrets and no `OUTBOUND_TEST_ALLOWED_HOSTS`.
- No `HEALTHCHECK`: the Worker exposes no endpoint. Liveness is the process and
  the `monitor worker ready` log line.
- Set at run time: `WORKER_ROLES`, `DATABASE_URL`, `REDIS_URL`,
  `CREDENTIAL_ENCRYPTION_KEYS`, `CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION`.
  Run one container per role (`monitor-scheduler`, `monitor-checker`) so each
  scales and stops on its own. Give the container a stop grace period of at
  least 30 s (Worker hard deadline 25 s).
- Production example (values come from the secret store):
  `docker run --rm -e WORKER_ROLES=monitor-checker -e DATABASE_URL -e REDIS_URL -e CREDENTIAL_ENCRYPTION_KEYS -e CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION nightwatch-worker`
  Without the two credential variables the Worker exits with
  `CREDENTIAL_ENCRYPTION_KEYS is required in production`.

Local compose: `compose.worker.yaml` adds `monitor-scheduler` and
`monitor-checker` to the dev stack (usage in its header; same project and
`NW_SLOT` as `compose.yaml`). It sets `NODE_ENV=development` explicitly, which
is the only way the Worker accepts the public dev key
(`CREDENTIAL_ENCRYPTION_KEYS` `{"dev":...}`). Production behaviour is unchanged:
with `NODE_ENV=production` the Worker rejects version `dev` and the public key.
Never reuse that file or env outside local development.

Deployment dependencies before release (not part of this image):

- Redis must be non-cluster. API rate-limit keys hash to different slots, so
  their `EVAL` fails with `CROSSSLOT` on a cluster.
- Network egress control of the production Worker network is a separate
  dependency in the F-005 spec. The image does not restrict outbound traffic;
  the SSRF helper is the only guard until that control exists.

## Partitions

`bun run db:partitions` after every `db:migrate` and at least monthly (see
`scripts/quality/README.md`). After NODE-F005-08S merges, the scheduler logs a
warning when fewer than 2 months ahead exist. On a `lock timeout` exit nothing
changed: rerun at low traffic with a short timeout (default 5000 ms, max 30000
ms). Do not raise the timeout to wait out a long lock. Creating or dropping a
partition is inferred to lock the parent table.
