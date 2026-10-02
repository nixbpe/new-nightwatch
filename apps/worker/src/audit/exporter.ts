import {
  AUDIT_EXPORT_FILE_TTL_HOURS,
  AUDIT_EXPORT_MAX_BYTES,
  AUDIT_EXPORT_MAX_EVENTS,
  auditScopeNote,
  type AuditExportFailureCode,
} from "@nightwatch/api-contract";
import {
  claimAuditExport,
  insertAuditExportNotificationIntent,
  withTenantUserContextRaw,
  type AuditExportClaim,
  type Database,
} from "@nightwatch/db";
import type { Logger } from "@nightwatch/shared";

import {
  EXPORT_BATCH_SIZE,
  readEventBatch,
  type BatchCursor,
  type ExportFilters,
  type TenantClient,
} from "./events";
import { ExportFileWriter, ExportTooLargeError } from "./file";

export const AUDIT_EXPORT_POLL_MS = 5_000;
/** Covers reading every batch and building the file. */
export const AUDIT_EXPORT_TIME_LIMIT_MS = 5 * 60_000;

export type ExportResult =
  /** The file was stored and the requester notified. */
  | "ready"
  /** The request ended as failed; the failure notification followed the P-07 rule. */
  | "failed"
  /** The lease or deadline was lost before the result could be stored. */
  | "discarded"
  /** Shutdown, a time limit or a database error: nothing was written, the lease will run out. */
  | "abandoned";

export type ExporterOptions = {
  pollMs?: number;
  timeLimitMs?: number;
  batchSize?: number;
  maxBytes?: number;
  maxEvents?: number;
  now?: () => Date;
  /** Test seam: runs after every batch is read, before the next one. */
  onBatch?: () => void | Promise<void>;
};

class TimeLimitError extends Error {}
class AbortedError extends Error {}

type ExportRequest = {
  format: "csv" | "json";
  filters: ExportFilters;
  timeZone: string;
  snapshotAt: Date;
  recordingStartedAt: Date;
  requesterMayExport: boolean;
  actorName: string | null;
};

/** `YYYY-MM-DD` of an instant in a time zone. */
function dateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function filterSummary(request: ExportRequest): string {
  const { filters } = request;
  const parts = [
    `from=${filters.from}`,
    `to=${filters.to}`,
    `categories=${(filters.categories ?? []).join("|") || "all"}`,
  ];
  if (filters.actorUserId) {
    parts.push(`actor=${request.actorName ?? "ไม่ใช่สมาชิกแล้ว"}`);
  }
  if (filters.q) parts.push(`search=${filters.q}`);
  return parts.join("; ");
}

export class AuditExporter {
  readonly #abort = new AbortController();
  readonly #pollMs: number;
  readonly #timeLimitMs: number;
  readonly #batchSize: number;
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  readonly #now: () => Date;
  readonly #onBatch: (() => void | Promise<void>) | undefined;
  #loop: Promise<void> | null = null;

  constructor(
    private readonly database: Database,
    private readonly logger: Logger,
    options: ExporterOptions = {},
  ) {
    this.#pollMs = options.pollMs ?? AUDIT_EXPORT_POLL_MS;
    this.#timeLimitMs = options.timeLimitMs ?? AUDIT_EXPORT_TIME_LIMIT_MS;
    this.#batchSize = options.batchSize ?? EXPORT_BATCH_SIZE;
    this.#maxBytes = options.maxBytes ?? AUDIT_EXPORT_MAX_BYTES;
    this.#maxEvents = options.maxEvents ?? AUDIT_EXPORT_MAX_EVENTS;
    this.#now = options.now ?? (() => new Date());
    this.#onBatch = options.onBatch;
  }

  /** Claims one request at a time until `stop()`; a claimed request starts the next round at once. */
  start(): void {
    if (this.#loop) return;
    this.#loop = this.#run();
  }

  /** Stops claiming and abandons the request in flight; its lease runs out and another claim redoes it. */
  async stop(): Promise<void> {
    this.#abort.abort();
    await this.#loop;
  }

  async #run(): Promise<void> {
    while (!this.#abort.signal.aborted) {
      let claimed = false;
      try {
        claimed = await this.runOnce();
      } catch {
        this.logger.error({}, "audit export round failed");
      }
      if (!claimed) await this.#sleep(this.#pollMs);
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const signal = this.#abort.signal;
      function done() {
        signal.removeEventListener("abort", done);
        clearTimeout(timer);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    });
  }

  /** One claim attempt; true when a request was claimed. */
  async runOnce(): Promise<boolean> {
    if (this.#abort.signal.aborted) return false;
    const claim = await claimAuditExport(this.database);
    if (!claim) return false;
    const result = await this.process(claim);
    this.logger.info(
      { exportId: claim.exportId, result },
      "audit export processed",
    );
    return true;
  }

  async process(claim: AuditExportClaim): Promise<ExportResult> {
    try {
      if (claim.exhausted) {
        return await this.#fail(claim, "EXPORT_FAILED");
      }
      const request = await this.#loadRequest(claim);
      if (!request) return "discarded";
      if (!request.requesterMayExport) {
        return await this.#fail(claim, "REQUESTER_NOT_AUTHORIZED");
      }
      const file = await this.#build(claim, request);
      return await this.#complete(claim, file);
    } catch (error) {
      if (error instanceof ExportTooLargeError) {
        return this.#fail(claim, "EXPORT_TOO_LARGE").catch(() => "abandoned");
      }
      if (error instanceof AbortedError || error instanceof TimeLimitError) {
        return "abandoned";
      }
      // A database or process fault writes nothing: the lease expires and the
      // request is claimed again, up to three times.
      this.logger.error(
        { exportId: claim.exportId },
        "audit export attempt failed",
      );
      return "abandoned";
    }
  }

  async #loadRequest(claim: AuditExportClaim): Promise<ExportRequest | null> {
    return withTenantUserContextRaw(
      this.database,
      claim.tenantId,
      claim.requestedBy,
      async (client) => {
        const result = await client.query<{
          format: "csv" | "json";
          filters: ExportFilters;
          timeZone: string;
          snapshotAt: Date;
          recordingStartedAt: Date;
          mayExport: boolean;
          actorName: string | null;
        }>(
          `select e.format, e.filters, e.time_zone as "timeZone",
                  e.snapshot_at as "snapshotAt",
                  o.audit_recording_started_at as "recordingStartedAt",
                  exists (
                    select 1 from member m,
                      unnest(string_to_array(m.role, ',')) as t
                    where m.organization_id = e.tenant_id and m.user_id = e.requested_by
                      and btrim(t) in ('owner', 'admin')
                  ) as "mayExport",
                  (select u.name from member am join "user" u on u.id = am.user_id
                   where am.organization_id = e.tenant_id
                     and am.user_id = e.filters->>'actorUserId') as "actorName"
           from audit_exports e join organization o on o.id = e.tenant_id
           where e.id = $1`,
          [claim.exportId],
        );
        const row = result.rows[0];
        return row
          ? {
              format: row.format,
              filters: row.filters,
              timeZone: row.timeZone,
              snapshotAt: row.snapshotAt,
              recordingStartedAt: row.recordingStartedAt,
              requesterMayExport: row.mayExport,
              actorName: row.actorName,
            }
          : null;
      },
    );
  }

  /** Reads batch by batch, each in its own short transaction, and builds the file in memory. */
  async #build(claim: AuditExportClaim, request: ExportRequest) {
    const startedAt = this.#now().getTime();
    const generatedAt = this.#now();
    const writer = new ExportFileWriter(
      request.format,
      {
        generatedAt: generatedAt.toISOString(),
        timeZone: request.timeZone,
        filters: filterSummary(request),
        scopeNote: auditScopeNote(
          dateInZone(request.recordingStartedAt, request.timeZone),
        ),
      },
      this.#maxBytes,
    );
    let cursor: BatchCursor | null = null;
    do {
      if (this.#abort.signal.aborted) throw new AbortedError();
      const remaining = this.#timeLimitMs - (this.#now().getTime() - startedAt);
      if (remaining <= 0) throw new TimeLimitError();
      const batch = await withTenantUserContextRaw(
        this.database,
        claim.tenantId,
        claim.requestedBy,
        async (client: TenantClient) => {
          await client.query(
            "select set_config('statement_timeout', $1, true)",
            [String(Math.max(1, Math.floor(remaining)))],
          );
          return readEventBatch(client, {
            tenantId: claim.tenantId,
            filters: request.filters,
            snapshotAt: request.snapshotAt,
            cursor,
            limit: this.#batchSize,
          });
        },
      ).catch((error: unknown) => {
        if ((error as { code?: string }).code === "57014") {
          throw new TimeLimitError();
        }
        throw error;
      });
      for (const event of batch.events) {
        writer.add(event);
        if (writer.rowCount > this.#maxEvents) throw new ExportTooLargeError();
      }
      cursor = batch.next;
      await this.#onBatch?.();
    } while (cursor);
    return writer.finish();
  }

  /** Stores the file only while this claim is current and the request is inside its lifetime. */
  async #complete(
    claim: AuditExportClaim,
    file: { content: Buffer; rowCount: number; byteSize: number },
  ): Promise<ExportResult> {
    if (this.#abort.signal.aborted) return "abandoned";
    return withTenantUserContextRaw(
      this.database,
      claim.tenantId,
      claim.requestedBy,
      async (client) => {
        const marked = await client.query(
          `update audit_export_jobs set state = 'ready'
           where export_id = $1 and claim_token = $2 and state = 'running'
             and now() < audit_export_deadline(created_at)`,
          [claim.exportId, claim.claimToken],
        );
        if (marked.rowCount !== 1) return "discarded";
        await client.query(
          `update audit_exports
           set content = $2, row_count = $3, byte_size = $4,
               completed_at = now(),
               file_expires_at = now() + make_interval(hours => $5::int)
           where id = $1`,
          [
            claim.exportId,
            file.content,
            file.rowCount,
            file.byteSize,
            AUDIT_EXPORT_FILE_TTL_HOURS,
          ],
        );
        await insertAuditExportNotificationIntent(client, {
          tenantId: claim.tenantId,
          exportId: claim.exportId,
          requesterUserId: claim.requestedBy,
          outcome: "ready",
        });
        return "ready";
      },
    );
  }

  /** Ends the request as failed, once, for the holder of the current token. */
  async #fail(
    claim: AuditExportClaim,
    code: AuditExportFailureCode,
  ): Promise<ExportResult> {
    return withTenantUserContextRaw(
      this.database,
      claim.tenantId,
      claim.requestedBy,
      async (client) => {
        const marked = await client.query(
          `update audit_export_jobs set state = 'failed'
           where export_id = $1 and claim_token = $2 and state = 'running'`,
          [claim.exportId, claim.claimToken],
        );
        if (marked.rowCount !== 1) return "discarded";
        await client.query(
          `update audit_exports set failure_code = $2, completed_at = now()
           where id = $1`,
          [claim.exportId, code],
        );
        await insertAuditExportNotificationIntent(client, {
          tenantId: claim.tenantId,
          exportId: claim.exportId,
          requesterUserId: claim.requestedBy,
          outcome: "failed",
        });
        return "failed";
      },
    );
  }
}
