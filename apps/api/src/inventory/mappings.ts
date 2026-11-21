import {
  type CpeCandidate,
  type InventoryMapping,
  type InventoryMappingList,
  type InventoryMappingUpdate,
  type MappingStatus,
} from "@nightwatch/api-contract";
import { AppError } from "@nightwatch/shared";
import type { PoolClient } from "pg";

import { recordAuditEvent } from "../audit/record";
import { withProjectAccess } from "../projects/service";
import { rankCandidates } from "./cpe";
import { identityKey } from "./rows";
import type { InventoryDeps, ProjectIdentity } from "./service";

type MappingRow = {
  id: string;
  vendor_key: string;
  product_key: string;
  vendor: string;
  product: string;
  status: MappingStatus;
  cpe: string | null;
  purl: string | null;
  confidence: number | null;
  source: "central" | "nvd" | "manual" | null;
  confirmed_at: Date | null;
};

const SYSTEMS_SHOWN = 5;
const COLUMNS = `id, vendor_key, product_key, vendor, product, status, cpe, purl,
  confidence, source, confirmed_at`;

function notFound(): never {
  throw new AppError(404, "INVENTORY_MAPPING_NOT_FOUND", "ไม่พบรายการ mapping");
}

/**
 * One mapping per distinct vendor and product pair of the Project's usable rows. A
 * new pair is confirmed from the operator catalog when it has one (S2.3) and waits
 * for review otherwise; a pair no usable row uses any more is dropped. Runs in the
 * upload transaction and makes no outside call.
 */
export async function syncMappings(
  client: PoolClient,
  tenant: string,
  project: string,
): Promise<void> {
  const { rows } = await client.query<{ vendor: string; product: string }>(
    `select distinct vendor, product from inventory_rows
     where tenant_id = $1 and project_id = $2 and usable`,
    [tenant, project],
  );
  const pairs = new Map<string, { vendor: string; product: string }>();
  for (const row of rows) {
    const key = `${identityKey(row.vendor)}\u0000${identityKey(row.product)}`;
    if (!pairs.has(key)) pairs.set(key, row);
  }
  const list = [...pairs.entries()].map(([key, pair]) => ({
    vendorKey: key.split("\u0000")[0] ?? "",
    productKey: key.split("\u0000")[1] ?? "",
    ...pair,
  }));
  await client.query(
    `insert into inventory_mappings
       (tenant_id, project_id, vendor_key, product_key, vendor, product, status, cpe, purl,
        source, confirmed_at)
     select $1, $2, p.vendor_key, p.product_key, p.vendor, p.product,
            case when c.vendor_key is null then 'pending' else 'confirmed' end,
            c.cpe, c.purl,
            case when c.vendor_key is null then null else 'central' end,
            case when c.vendor_key is null then null else now() end
     from unnest($3::text[], $4::text[], $5::text[], $6::text[])
            as p(vendor_key, product_key, vendor, product)
     left join catalog_product_mappings c
       on c.vendor_key = p.vendor_key and c.product_key = p.product_key
     on conflict (project_id, vendor_key, product_key) do nothing`,
    [
      tenant,
      project,
      list.map((pair) => pair.vendorKey),
      list.map((pair) => pair.productKey),
      list.map((pair) => pair.vendor),
      list.map((pair) => pair.product),
    ],
  );
  await client.query(
    `delete from inventory_mappings
     where tenant_id = $1 and project_id = $2
       and (vendor_key, product_key) not in
         (select * from unnest($3::text[], $4::text[]))`,
    [
      tenant,
      project,
      list.map((pair) => pair.vendorKey),
      list.map((pair) => pair.productKey),
    ],
  );
}

async function usage(client: PoolClient, tenant: string, project: string) {
  const { rows } = await client.query<{
    vendor: string;
    product: string;
    system: string;
  }>(
    `select r.vendor, r.product, s.name as system
     from inventory_rows r join inventory_systems s on s.id = r.system_id
     where r.tenant_id = $1 and r.project_id = $2 and r.usable
     order by s.name_key`,
    [tenant, project],
  );
  const used = new Map<string, { rows: number; systems: Set<string> }>();
  for (const row of rows) {
    const key = `${identityKey(row.vendor)}\u0000${identityKey(row.product)}`;
    const entry = used.get(key) ?? { rows: 0, systems: new Set<string>() };
    entry.rows += 1;
    entry.systems.add(row.system === "" ? "(ไม่ระบุชื่อ System)" : row.system);
    used.set(key, entry);
  }
  return used;
}

function toItem(
  row: MappingRow,
  used: Map<string, { rows: number; systems: Set<string> }>,
): InventoryMapping {
  const entry = used.get(`${row.vendor_key}\u0000${row.product_key}`);
  return {
    id: row.id,
    vendor: row.vendor,
    product: row.product,
    status: row.status,
    cpe: row.cpe,
    purl: row.purl,
    confidence: row.confidence,
    source: row.source,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    rows: entry?.rows ?? 0,
    systems: [...(entry?.systems ?? [])].slice(0, SYSTEMS_SHOWN),
  };
}

async function loadItems(
  client: PoolClient,
  tenant: string,
  project: string,
  where: { status?: MappingStatus; id?: string } = {},
): Promise<InventoryMapping[]> {
  const { rows } = await client.query<MappingRow>(
    `select ${COLUMNS} from inventory_mappings
     where tenant_id = $1 and project_id = $2
       and ($3::text is null or status = $3) and ($4::uuid is null or id = $4)
     order by status, lower(vendor), lower(product)`,
    [tenant, project, where.status ?? null, where.id ?? null],
  );
  const used = await usage(client, tenant, project);
  return rows.map((row) => toItem(row, used));
}

async function lockMapping(
  client: PoolClient,
  tenant: string,
  project: string,
  id: string,
): Promise<MappingRow> {
  const { rows } = await client.query<MappingRow>(
    `select ${COLUMNS} from inventory_mappings
     where tenant_id = $1 and project_id = $2 and id = $3 for update`,
    [tenant, project, id],
  );
  return rows[0] ?? notFound();
}

const canManage = (access: { kind: string; role?: string }) =>
  access.kind === "org-admin" ||
  (access.kind === "member" && access.role === "admin");

export function listMappings(
  deps: InventoryDeps,
  input: ProjectIdentity,
  status?: MappingStatus,
): Promise<InventoryMappingList> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.read",
    false,
    async (client, { projectId, access }) => {
      const all = await loadItems(client, input.organizationId, projectId);
      const counts = { pending: 0, confirmed: 0, unmapped: 0 };
      for (const item of all) counts[item.status] += 1;
      return {
        canManage: canManage(access),
        counts,
        items:
          status === undefined
            ? all
            : all.filter((item) => item.status === status),
      };
    },
  );
}

export function updateMapping(
  deps: InventoryDeps,
  input: ProjectIdentity & { mappingId: string },
  update: InventoryMappingUpdate,
): Promise<InventoryMapping> {
  return withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId, actorRole }) => {
      const tenant = input.organizationId;
      const current = await lockMapping(
        client,
        tenant,
        projectId,
        input.mappingId,
      );
      if (update.action === "unmapped") {
        await client.query(
          `update inventory_mappings
           set status = 'unmapped', cpe = null, purl = null, confidence = null,
               source = null, confirmed_by = $4, confirmed_at = now(), updated_at = now()
           where tenant_id = $1 and project_id = $2 and id = $3`,
          [tenant, projectId, input.mappingId, input.actorUserId],
        );
      } else {
        const typed = update.cpe !== undefined || update.purl !== undefined;
        const cpe = typed ? (update.cpe ?? null) : current.cpe;
        const purl = typed ? (update.purl ?? null) : current.purl;
        if (cpe === null && purl === null) {
          throw new AppError(
            400,
            "MAPPING_IDENTIFIER_REQUIRED",
            "ต้องมี CPE หรือ purl ก่อนยืนยัน",
          );
        }
        await client.query(
          `update inventory_mappings
           set status = 'confirmed', cpe = $4, purl = $5,
               confidence = $6, source = $7, confirmed_by = $8, confirmed_at = now(),
               updated_at = now()
           where tenant_id = $1 and project_id = $2 and id = $3`,
          [
            tenant,
            projectId,
            input.mappingId,
            cpe,
            purl,
            typed ? null : current.confidence,
            typed ? "manual" : (current.source ?? "manual"),
            input.actorUserId,
          ],
        );
      }
      await recordAuditEvent(client, {
        ...input,
        actorRole,
        action: "organization.project.inventory.mapping.update",
        target: { type: "project", id: projectId },
        changes: [],
      });
      const [item] = await loadItems(client, tenant, projectId, {
        id: input.mappingId,
      });
      return item ?? notFound();
    },
  );
}

async function limitLookups(deps: InventoryDeps, input: ProjectIdentity) {
  if (!deps.rateLimiter || !deps.cpeSearch) {
    throw new AppError(
      503,
      "CPE_DICTIONARY_UNAVAILABLE",
      "บริการค้น CPE dictionary ยังไม่พร้อม",
    );
  }
  // NVD allows 5 requests per 30 s without an API key and sees one egress address,
  // so one shared key holds every Organization under that.
  return deps.rateLimiter.consumeRateLimits({
    windowMs: 30_000,
    limits: [
      { key: "rl:nvd-cpe:global", limit: 4 },
      {
        key: `rl:nvd-cpe:u:${input.actorUserId}:p:${input.projectId}`,
        limit: 8,
      },
    ],
  });
}

async function candidatesFor(
  deps: InventoryDeps,
  input: ProjectIdentity & { mappingId: string },
  query: string | undefined,
): Promise<
  | { retryAfterSeconds: number }
  | { mapping: MappingRow; projectId: string; candidates: CpeCandidate[] }
> {
  const found = await withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    false,
    async (client, { projectId }) => ({
      projectId,
      mapping: await lockMappingShared(
        client,
        input.organizationId,
        projectId,
        input.mappingId,
      ),
    }),
  );
  const limit = await limitLookups(deps, input);
  if (!limit.allowed) return { retryAfterSeconds: limit.retryAfterSeconds };
  const search = deps.cpeSearch;
  if (!search)
    throw new AppError(
      503,
      "CPE_DICTIONARY_UNAVAILABLE",
      "บริการค้น CPE dictionary ยังไม่พร้อม",
    );
  const names = await search(
    query ?? `${found.mapping.vendor} ${found.mapping.product}`,
  );
  return {
    ...found,
    candidates: rankCandidates(
      found.mapping.vendor,
      found.mapping.product,
      names,
    ),
  };
}

async function lockMappingShared(
  client: PoolClient,
  tenant: string,
  project: string,
  id: string,
): Promise<MappingRow> {
  const { rows } = await client.query<MappingRow>(
    `select ${COLUMNS} from inventory_mappings
     where tenant_id = $1 and project_id = $2 and id = $3`,
    [tenant, project, id],
  );
  return rows[0] ?? notFound();
}

/** Keyword search of the NVD CPE dictionary for the review dialog; changes nothing. */
export async function searchCpe(
  deps: InventoryDeps,
  input: ProjectIdentity & { mappingId: string },
  query: string,
): Promise<{ retryAfterSeconds: number } | { candidates: CpeCandidate[] }> {
  const result = await candidatesFor(deps, input, query);
  return "retryAfterSeconds" in result
    ? result
    : { candidates: result.candidates };
}

/**
 * Stores the best dictionary match of a pending mapping as its suggestion (S2.1). It
 * stays pending: nothing is matched until a person confirms it. A mapping that was
 * decided meanwhile keeps its decision.
 */
export async function suggestMapping(
  deps: InventoryDeps,
  input: ProjectIdentity & { mappingId: string },
): Promise<
  | { retryAfterSeconds: number }
  | { item: InventoryMapping; candidates: CpeCandidate[] }
> {
  const result = await candidatesFor(deps, input, undefined);
  if ("retryAfterSeconds" in result) return result;
  const best = result.candidates[0];
  const item = await withProjectAccess(
    deps.database,
    input,
    "inventory.write",
    true,
    async (client, { projectId }) => {
      if (best && best.confidence > 0) {
        await client.query(
          `update inventory_mappings
           set cpe = $4, purl = null, confidence = $5, source = 'nvd', updated_at = now()
           where tenant_id = $1 and project_id = $2 and id = $3 and status = 'pending'`,
          [
            input.organizationId,
            projectId,
            input.mappingId,
            best.cpe,
            best.confidence,
          ],
        );
      }
      const [loaded] = await loadItems(
        client,
        input.organizationId,
        projectId,
        {
          id: input.mappingId,
        },
      );
      return loaded ?? notFound();
    },
  );
  return { item, candidates: result.candidates };
}
