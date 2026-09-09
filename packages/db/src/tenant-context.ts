import type { ExtractTablesWithRelations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";

import type { Database } from "./client";
import type { schema } from "./schema";

/** Transaction handle passed to tenant-scoped work: the full schema plus
 * its inferred relation tables (the schema declares no relations yet, but
 * the type must stay correct when they land). */
type TenantTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

/**
 * Tenant-scoped work on the Drizzle handle.
 *
 * Opens a transaction and sets `app.tenant_id` with `set_config(..., true)`
 * so the value is transaction-local and cleared on commit/rollback. Every
 * query — including raw ones — must run on the supplied `tx`.
 *
 * Scope limit: this context is for domain tables that carry `tenant_id`
 * and are protected by RLS. The global auth tables (user, session, account,
 * verification, organization, member, invitation, twoFactor) are
 * pre-tenant: login and membership resolution must happen before any
 * tenant context exists, so they are intentionally NOT tenant-scoped here.
 * Cross-tenant isolation for auth data is enforced by verified-membership
 * lookups and Better Auth's own organization-bound queries, not by RLS.
 */
export async function withTenantContext<T>(
  database: Database,
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  return database.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Tenant-scoped raw SQL on a dedicated pooled connection (for API code that
 * needs `pg` directly instead of Drizzle). Same transaction-local
 * `app.tenant_id` contract as `withTenantContext`.
 */
export async function withTenantContextRaw<T>(
  database: Database,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  const client = await database.sql.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function assertTenantId(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error("tenantId must be a UUID");
  }
}
