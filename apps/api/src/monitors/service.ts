import {
  MONITOR_LIMIT_PER_ORGANIZATION,
  type MonitorCreateInput,
  type MonitorEditInput,
  type MonitorInvalidReason,
  type MonitorRecord,
} from "@nightwatch/api-contract";
import { withTenantContextRaw, type Database } from "@nightwatch/db";
import {
  AppError,
  buildCheckUrl,
  maskUrl,
  resolveOutboundHost,
  type OutboundDeps,
  type UrlRejection,
} from "@nightwatch/shared";
import type { PoolClient } from "pg";

import {
  assertMemberPermissionBeforeTenantContext,
  assertMonitorPermission,
  membershipDenied,
} from "./permissions";
import {
  affectsChecks,
  MONITOR_COLUMNS,
  sameConfig,
  storedFromRow,
  toRecord,
  toStoredConfig,
  type MonitorRow,
  type StoredConfig,
} from "./record";

export type MonitorMutation = {
  monitor: MonitorRecord;
  /** False for an idempotent no-op or a replayed Create: nothing was written. */
  changed: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function monitorNotFound(): never {
  throw new AppError(404, "MONITOR_NOT_FOUND", "ไม่พบมอนิเตอร์นี้");
}

// A malformed id answers like a missing or foreign one (AC-48).
function parseMonitorId(raw: string): string {
  if (!UUID_PATTERN.test(raw)) monitorNotFound();
  return raw;
}

const URL_REASONS: Record<
  Exclude<UrlRejection, "blocked_address">,
  MonitorInvalidReason
> = {
  invalid_url: "invalid_format",
  unsupported_scheme: "blocked_scheme",
  userinfo_not_allowed: "embedded_credentials",
  url_too_long: "too_long",
  port_not_allowed: "blocked_port",
};

function targetBlocked(): never {
  throw new AppError(
    422,
    "MONITOR_TARGET_BLOCKED",
    "ปลายทางนี้ไม่อนุญาตให้ตรวจ",
    { field: "url" },
  );
}

/**
 * Save-time URL checks (AC-09, AC-28). The URL is built exactly as a check
 * builds it, so a URL that only becomes too long after the query params are
 * added is rejected now instead of failing every check later. Resolution runs
 * outside any transaction (REQ-01) and sends no HTTP request. A name that does
 * not resolve is savable: the target may be down for a moment.
 * Returns the masked URL to record in `config_changed`.
 */
async function validateSaveTarget(
  input: { url: string; queryParams: { name: string; value: string }[] },
  outbound: OutboundDeps,
): Promise<string> {
  const built = buildCheckUrl(input.url, input.queryParams);
  if (!built.ok) {
    if (built.reason === "blocked_address") targetBlocked();
    throw new AppError(400, "MONITOR_INVALID", "Invalid monitor input", {
      fields: [{ field: "url", reason: URL_REASONS[built.reason] }],
    });
  }
  const resolved = await resolveOutboundHost(built.url, outbound);
  if (!resolved.ok && resolved.reason === "blocked_address") targetBlocked();
  return maskUrl(built.url.href);
}

// History marks a URL change when the masked built URL differs, so a new or
// renamed query param shows; a value-only change looks identical once masked.
function urlMarker(previous: StoredConfig, nextMasked: string): string | null {
  const before = buildCheckUrl(previous.url, previous.queryParams);
  return before.ok && maskUrl(before.url.href) === nextMasked
    ? null
    : nextMasked;
}

type Identity = { organizationId: string; actorUserId: string };

// Lock order shared with the Worker: organization row, then the
// per-Organization advisory lock (Create only), monitors row, schedule row,
// incidents. The role is read again under the lock because it may have
// changed since the pre-check.
async function enterOrganization(
  client: PoolClient,
  identity: Identity,
): Promise<void> {
  const organization = await client.query(
    "select id from organization where id = $1 for share",
    [identity.organizationId],
  );
  if (organization.rows.length === 0) membershipDenied();
  const member = await client.query<{ role: string }>(
    "select role from member where organization_id = $1 and user_id = $2",
    [identity.organizationId, identity.actorUserId],
  );
  assertMonitorPermission(member.rows[0]?.role, "write");
}

async function secretSlots(
  client: PoolClient,
  monitorId: string,
): Promise<string[]> {
  const result = await client.query<{ slot: string }>(
    "select slot from monitor_secrets where monitor_id = $1 order by slot",
    [monitorId],
  );
  return result.rows.map((row) => row.slot);
}

async function loadRecord(
  client: PoolClient,
  row: MonitorRow,
): Promise<MonitorRecord> {
  return toRecord(row, await secretSlots(client, row.id));
}

async function lockMonitor(
  client: PoolClient,
  identity: Identity,
  monitorId: string,
): Promise<MonitorRow> {
  const result = await client.query<MonitorRow>(
    `select ${MONITOR_COLUMNS} from monitors
     where id = $1 and tenant_id = $2 for update`,
    [monitorId, identity.organizationId],
  );
  const row = result.rows[0];
  if (!row) monitorNotFound();
  return row;
}

// Existence check before any network work; the real lookup repeats under lock.
async function assertMonitorExists(
  database: Database,
  identity: Identity,
  monitorId: string,
): Promise<void> {
  const found = await withTenantContextRaw(
    database,
    identity.organizationId,
    (client) =>
      client.query("select 1 from monitors where id = $1 and tenant_id = $2", [
        monitorId,
        identity.organizationId,
      ]),
  );
  if (found.rows.length === 0) monitorNotFound();
}

function configParameters(stored: StoredConfig): unknown[] {
  return [
    stored.name,
    stored.url,
    stored.method,
    JSON.stringify(stored.headers),
    JSON.stringify(stored.queryParams),
    stored.bodyType,
    stored.bodyContent,
    stored.authType,
    stored.apiKeyHeaderName,
    stored.expectedStatusText,
    JSON.stringify(stored.expectedStatusRanges),
    JSON.stringify(stored.assertions),
    stored.intervalSeconds,
    stored.timeoutSeconds,
  ];
}

export async function createMonitor(
  database: Database,
  input: Identity & { input: MonitorCreateInput; outbound?: OutboundDeps },
): Promise<MonitorMutation> {
  await assertMemberPermissionBeforeTenantContext(database, {
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: "write",
  });
  await validateSaveTarget(input.input, input.outbound ?? {});
  const stored = toStoredConfig(input.input);

  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      await enterOrganization(client, input);
      await client.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
        `monitors:${input.organizationId}`,
      ]);

      // A replay must win over the limit: the original already counts.
      const replay = await client.query<MonitorRow>(
        `select ${MONITOR_COLUMNS} from monitors
       where tenant_id = $1 and client_request_id = $2`,
        [input.organizationId, input.input.clientRequestId],
      );
      const original = replay.rows[0];
      if (original) {
        return { monitor: await loadRecord(client, original), changed: false };
      }

      const count = await client.query<{ total: string }>(
        "select count(*) as total from monitors where tenant_id = $1",
        [input.organizationId],
      );
      if (Number(count.rows[0]?.total ?? 0) >= MONITOR_LIMIT_PER_ORGANIZATION) {
        throw new AppError(
          409,
          "MONITOR_LIMIT_REACHED",
          "องค์กรนี้มีมอนิเตอร์ครบจำนวนสูงสุดแล้ว",
        );
      }

      const inserted = await client.query<MonitorRow>(
        `insert into monitors
         (tenant_id, client_request_id, name, url, method, headers,
          query_params, body_type, body_content, auth_type,
          api_key_header_name, expected_status_text, expected_status_ranges,
          assertions, interval_seconds, timeout_seconds)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12,
               $13::jsonb, $14::jsonb, $15, $16)
       returning ${MONITOR_COLUMNS}`,
        [
          input.organizationId,
          input.input.clientRequestId,
          ...configParameters(stored),
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("monitor insert returned no row");
      await client.query(
        `insert into monitor_schedule
         (monitor_id, tenant_id, next_check_at, check_config_version,
          interval_seconds, timeout_seconds)
       values ($1, $2, now(), 1, $3, $4)`,
        [row.id, input.organizationId, row.intervalSeconds, row.timeoutSeconds],
      );
      return { monitor: toRecord(row, []), changed: true };
    },
  );
}

export async function editMonitor(
  database: Database,
  input: Identity & {
    monitorId: string;
    input: MonitorEditInput;
    outbound?: OutboundDeps;
  },
): Promise<MonitorMutation> {
  await assertMemberPermissionBeforeTenantContext(database, {
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: "write",
  });
  const monitorId = parseMonitorId(input.monitorId);
  await assertMonitorExists(database, input, monitorId);
  const maskedUrl = await validateSaveTarget(input.input, input.outbound ?? {});
  const next = toStoredConfig(input.input);

  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      await enterOrganization(client, input);
      const row = await lockMonitor(client, input, monitorId);
      if (row.version !== input.input.expectedVersion) {
        throw new AppError(
          409,
          "MONITOR_VERSION_CONFLICT",
          "มอนิเตอร์ถูกแก้ไขแล้ว",
          { currentVersion: row.version },
        );
      }
      const previous = storedFromRow(row);
      if (sameConfig(previous, next)) {
        return { monitor: await loadRecord(client, row), changed: false };
      }

      const impacted = affectsChecks(previous, next);
      const intervalChanged = previous.intervalSeconds !== next.intervalSeconds;
      const updated = await client.query<
        MonitorRow & { checkConfigVersion: number }
      >(
        `update monitors set
         name = $3, url = $4, method = $5, headers = $6::jsonb,
         query_params = $7::jsonb, body_type = $8, body_content = $9,
         auth_type = $10, api_key_header_name = $11,
         expected_status_text = $12, expected_status_ranges = $13::jsonb,
         assertions = $14::jsonb, interval_seconds = $15, timeout_seconds = $16,
         version = version + 1,
         check_config_version = check_config_version + $17::int,
         consecutive_failures = case when $17::int = 1 then 0
                                     else consecutive_failures end,
         updated_at = now()
       where id = $1 and tenant_id = $2
       returning ${MONITOR_COLUMNS}, check_config_version as "checkConfigVersion"`,
        [
          monitorId,
          input.organizationId,
          ...configParameters(next),
          impacted ? 1 : 0,
        ],
      );
      const saved = updated.rows[0];
      if (!saved) throw new Error("monitor update returned no row");

      // A paused monitor keeps next_check_at NULL, so it stays unclaimable.
      // GREATEST ignores NULL, so a never-checked monitor stays due now.
      if (impacted) {
        await client.query(
          `update monitor_schedule set
           check_config_version = $2, interval_seconds = $3,
           timeout_seconds = $4, claim_token = null, claimed_until = null,
           next_check_at = case when $5 = 'paused' then null else now() end
         where monitor_id = $1`,
          [
            monitorId,
            saved.checkConfigVersion,
            next.intervalSeconds,
            next.timeoutSeconds,
            saved.status,
          ],
        );
      } else if (intervalChanged) {
        await client.query(
          `update monitor_schedule set interval_seconds = $2::int,
           next_check_at = case
             when next_check_at is null then null
             else greatest(now(), $3::timestamptz + make_interval(secs => $2::int))
           end
         where monitor_id = $1`,
          [monitorId, next.intervalSeconds, saved.lastCheckAt],
        );
      }

      await client.query(
        `insert into monitor_events (monitor_id, tenant_id, kind, url_masked)
       values ($1, $2, 'config_changed', $3)`,
        [monitorId, input.organizationId, urlMarker(previous, maskedUrl)],
      );
      return { monitor: await loadRecord(client, saved), changed: true };
    },
  );
}

export async function pauseMonitor(
  database: Database,
  input: Identity & { monitorId: string },
): Promise<MonitorMutation> {
  return changeMonitorStatus(database, input, "paused");
}

export async function resumeMonitor(
  database: Database,
  input: Identity & { monitorId: string },
): Promise<MonitorMutation> {
  return changeMonitorStatus(database, input, "active");
}

async function changeMonitorStatus(
  database: Database,
  input: Identity & { monitorId: string },
  target: "active" | "paused",
): Promise<MonitorMutation> {
  await assertMemberPermissionBeforeTenantContext(database, {
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: "write",
  });
  const monitorId = parseMonitorId(input.monitorId);

  return withTenantContextRaw(
    database,
    input.organizationId,
    async (client) => {
      await enterOrganization(client, input);
      const row = await lockMonitor(client, input, monitorId);
      if (row.status === target) {
        return { monitor: await loadRecord(client, row), changed: false };
      }

      const updated = await client.query<MonitorRow>(
        // Resume restarts the failure streak (AC-19).
        `update monitors set status = $3, version = version + 1,
         consecutive_failures = case when $3 = 'active' then 0
                                     else consecutive_failures end,
         updated_at = now()
       where id = $1 and tenant_id = $2
       returning ${MONITOR_COLUMNS}`,
        [monitorId, input.organizationId, target],
      );
      const saved = updated.rows[0];
      if (!saved) throw new Error("monitor update returned no row");

      // Pause clears the claim so a late result is dropped, and NULL makes the
      // row unclaimable; Resume is due immediately (AC-54).
      await client.query(
        `update monitor_schedule set claim_token = null, claimed_until = null,
         next_check_at = case when $2 = 'paused' then null else now() end
       where monitor_id = $1`,
        [monitorId, target],
      );
      if (target === "paused") {
        await client.query(
          `update monitor_incidents set ended_at = now(),
           end_reason = 'paused_by_user'
         where monitor_id = $1 and ended_at is null`,
          [monitorId],
        );
      }
      await client.query(
        `insert into monitor_events (monitor_id, tenant_id, kind)
       values ($1, $2, $3)`,
        [
          monitorId,
          input.organizationId,
          target === "paused" ? "paused" : "resumed",
        ],
      );
      return { monitor: await loadRecord(client, saved), changed: true };
    },
  );
}

// Children (schedule, secrets, results, incidents, events) go with the row, so
// a late result finds no schedule row and is dropped. Notifications keep a
// snapshot of the name and outlive the monitor.
export async function deleteMonitor(
  database: Database,
  input: Identity & { monitorId: string },
): Promise<void> {
  await assertMemberPermissionBeforeTenantContext(database, {
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: "write",
  });
  const monitorId = parseMonitorId(input.monitorId);

  await withTenantContextRaw(database, input.organizationId, async (client) => {
    await enterOrganization(client, input);
    await lockMonitor(client, input, monitorId);
    await client.query(
      "delete from monitors where id = $1 and tenant_id = $2",
      [monitorId, input.organizationId],
    );
  });
}
