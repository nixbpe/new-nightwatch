import {
  AUDIT_ACTION_LABELS,
  type AuditChange,
  type AuditCategory,
  type AuditValue,
} from "@nightwatch/shared";

/** One event as it appears in a file: the fields of the detail page, no ids of people. */
export type ExportEvent = {
  id: string;
  /** ISO 8601, UTC. */
  occurredAt: string;
  actor: {
    displayName: string | null;
    roleAtTime: string;
    membership: "current" | "former";
  };
  action: keyof typeof AUDIT_ACTION_LABELS;
  category: AuditCategory;
  /** The label the page shows for the target. */
  target: string;
  changes: AuditChange[];
};

export type ExportMeta = {
  generatedAt: string;
  timeZone: string;
  /** Plain-text summary of the filters, shown in the CSV preamble. */
  filters: string;
  scopeNote: string;
};

export class ExportTooLargeError extends Error {
  constructor() {
    super("export file is over the size limit");
    this.name = "ExportTooLargeError";
  }
}

export const FORMER_MEMBER_LABEL = "ไม่ใช่สมาชิกแล้ว";

// Spreadsheets read a cell that starts with one of these as a formula. Monitor
// and member names are user input, so every cell is guarded.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded;
}

function valueText(value: AuditValue | null): string {
  if (value === null) return "-";
  switch (value.kind) {
    case "value":
      return value.value === null ? "-" : String(value.value);
    case "masked":
      return "•••";
    case "secret_set":
      return "ตั้งค่าแล้ว";
    case "changed":
      return "เปลี่ยนแล้ว";
  }
}

/** `field: ก่อน → หลัง`, with the name of a header, query parameter or secret slot. */
export function changeText(change: AuditChange): string {
  const label = change.key ? `${change.field} (${change.key})` : change.field;
  return `${label}: ${valueText(change.before)} → ${valueText(change.after)}`;
}

const CSV_HEADER = [
  "occurred_at_utc",
  "event_id",
  "actor_name",
  "actor_role_at_time",
  "action_label",
  "action_code",
  "category",
  "target",
  "changes",
];

/**
 * Builds one file in memory and refuses to grow past `maxBytes`. The preamble
 * and every row are counted, so the size the caller sees is the size stored.
 */
export class ExportFileWriter {
  readonly #format: "csv" | "json";
  readonly #maxBytes: number;
  readonly #chunks: string[] = [];
  #bytes = 0;
  #rows = 0;

  constructor(format: "csv" | "json", meta: ExportMeta, maxBytes: number) {
    this.#format = format;
    this.#maxBytes = maxBytes;
    if (format === "csv") {
      this.#push(
        [
          "﻿" + ["generated_at_utc", meta.generatedAt].map(csvCell).join(","),
          ["time_zone", meta.timeZone].map(csvCell).join(","),
          ["filters", meta.filters].map(csvCell).join(","),
          ["scope_note", meta.scopeNote].map(csvCell).join(","),
          "",
          CSV_HEADER.join(","),
          "",
        ].join("\r\n"),
      );
    } else {
      this.#push(
        `{"meta":${JSON.stringify({
          generatedAt: meta.generatedAt,
          timeZone: meta.timeZone,
          filters: meta.filters,
          scopeNote: meta.scopeNote,
        })},"events":[`,
      );
    }
  }

  get rowCount(): number {
    return this.#rows;
  }

  add(event: ExportEvent): void {
    if (this.#format === "csv") {
      this.#push(
        [
          event.occurredAt,
          event.id,
          event.actor.displayName ?? FORMER_MEMBER_LABEL,
          event.actor.roleAtTime,
          AUDIT_ACTION_LABELS[event.action],
          event.action,
          event.category,
          event.target,
          event.changes.map(changeText).join("; "),
        ]
          .map(csvCell)
          .join(",") + "\r\n",
      );
    } else {
      this.#push(
        `${this.#rows === 0 ? "" : ","}${JSON.stringify({
          id: event.id,
          occurredAt: event.occurredAt,
          actor: event.actor,
          action: event.action,
          actionLabel: AUDIT_ACTION_LABELS[event.action],
          category: event.category,
          target: event.target,
          changes: event.changes,
        })}`,
      );
    }
    this.#rows += 1;
  }

  finish(): { content: Buffer; rowCount: number; byteSize: number } {
    if (this.#format === "json") this.#push("]}");
    const content = Buffer.from(this.#chunks.join(""), "utf8");
    return { content, rowCount: this.#rows, byteSize: content.length };
  }

  #push(chunk: string): void {
    this.#bytes += Buffer.byteLength(chunk, "utf8");
    if (this.#bytes > this.#maxBytes) throw new ExportTooLargeError();
    this.#chunks.push(chunk);
  }
}
