import type { PoolClient } from "pg";

import type { Database } from "./client";
import { withRawTransaction } from "./raw-transaction";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs tenant-owned SQL on one pooled transaction. Every query uses the supplied
 * client; transaction-local context is cleared on commit or rollback. Auth tables
 * are pre-tenant and use membership-bound authorization instead.
 */
export async function withTenantContextRaw<T>(
  database: Database,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  return withRawTransaction(database, async (client) => {
    await client.query("select set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    return fn(client);
  });
}

/**
 * `withTenantContextRaw` plus `app.user_id`, for tables that are scoped to one
 * user inside an Organization (audit exports).
 */
export async function withTenantUserContextRaw<T>(
  database: Database,
  tenantId: string,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  if (userId === "") throw new Error("userId must not be empty");
  return withRawTransaction(database, async (client) => {
    await client.query("select set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    return fn(client);
  });
}

function assertTenantId(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error("tenantId must be a UUID");
  }
}
