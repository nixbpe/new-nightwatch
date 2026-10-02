import { describe, expect, it } from "vitest";

import {
  changeText,
  csvCell,
  ExportFileWriter,
  ExportTooLargeError,
  type ExportEvent,
  type ExportMeta,
} from "./file";

const meta: ExportMeta = {
  generatedAt: "2026-10-03T10:00:00.000Z",
  timeZone: "Asia/Bangkok",
  filters: "from=a; to=b",
  scopeNote: "note, with comma",
};

const event = (overrides: Partial<ExportEvent> = {}): ExportEvent => ({
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-10-03T09:00:00.123Z",
  actor: { displayName: "Somchai", roleAtTime: "admin", membership: "current" },
  action: "organization.monitor.update",
  category: "monitor",
  target: "api-prod",
  changes: [],
  ...overrides,
});

describe("csvCell", () => {
  it.each([
    ['=HYPERLINK("http://x")', '"\'=HYPERLINK(""http://x"")"'],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\rcmd", '"\'\rcmd"'],
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line\nbreak", '"line\nbreak"'],
  ])("%j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
});

describe("changeText", () => {
  it("shows before and after, names a header or slot, and never a masked or secret value", () => {
    expect(
      changeText({
        field: "role",
        before: { kind: "value", value: "viewer" },
        after: { kind: "value", value: "admin" },
      }),
    ).toBe("role: viewer → admin");
    expect(
      changeText({
        field: "queryParam",
        key: "token",
        before: { kind: "masked" },
        after: null,
      }),
    ).toBe("queryParam (token): ••• → -");
    expect(
      changeText({
        field: "secret",
        key: "auth.token",
        before: { kind: "secret_set" },
        after: { kind: "changed" },
      }),
    ).toBe("secret (auth.token): ตั้งค่าแล้ว → เปลี่ยนแล้ว");
    expect(
      changeText({ field: "body", before: null, after: { kind: "changed" } }),
    ).toBe("body: - → เปลี่ยนแล้ว");
  });
});

describe("ExportFileWriter csv", () => {
  it("writes a BOM, a four-row preamble, a blank line, a header and CRLF rows", () => {
    const writer = new ExportFileWriter("csv", meta, 1_000_000);
    writer.add(
      event({
        changes: [
          {
            field: "name",
            before: { kind: "value", value: "a" },
            after: { kind: "value", value: "b" },
          },
          { field: "body", before: null, after: { kind: "changed" } },
        ],
      }),
    );
    const { content, rowCount, byteSize } = writer.finish();
    expect(rowCount).toBe(1);
    expect(byteSize).toBe(content.length);
    const text = content.toString("utf8");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.split("\r\n")).toEqual([
      "﻿generated_at_utc,2026-10-03T10:00:00.000Z",
      "time_zone,Asia/Bangkok",
      "filters,from=a; to=b",
      'scope_note,"note, with comma"',
      "",
      "occurred_at_utc,event_id,actor_name,actor_role_at_time,action_label,action_code,category,target,changes",
      "2026-10-03T09:00:00.123Z,11111111-1111-4111-8111-111111111111,Somchai,admin,แก้ไขมอนิเตอร์,organization.monitor.update,monitor,api-prod,name: a → b; body: - → เปลี่ยนแล้ว",
      "",
    ]);
  });

  it("guards names that begin like a formula and labels a former member", () => {
    const writer = new ExportFileWriter("csv", meta, 1_000_000);
    writer.add(
      event({
        target: '=HYPERLINK("http://evil","x")',
        actor: { displayName: null, roleAtTime: "owner", membership: "former" },
      }),
    );
    const text = writer.finish().content.toString("utf8");
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(text).toContain(",ไม่ใช่สมาชิกแล้ว,owner,");
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it("stops with ExportTooLargeError once the file would pass the limit", () => {
    const writer = new ExportFileWriter("csv", meta, 700);
    expect(() => {
      for (let i = 0; i < 50; i += 1) writer.add(event());
    }).toThrow(ExportTooLargeError);
  });
});

describe("ExportFileWriter json", () => {
  it("writes meta and events with the labels and the structured actor", () => {
    const writer = new ExportFileWriter("json", meta, 1_000_000);
    writer.add(event());
    writer.add(event({ id: "22222222-2222-4222-8222-222222222222" }));
    const { content, rowCount } = writer.finish();
    expect(rowCount).toBe(2);
    expect(content.toString("utf8").startsWith("﻿")).toBe(false);
    const parsed = JSON.parse(content.toString("utf8")) as {
      meta: unknown;
      events: Record<string, unknown>[];
    };
    expect(parsed.meta).toEqual({
      generatedAt: "2026-10-03T10:00:00.000Z",
      timeZone: "Asia/Bangkok",
      filters: "from=a; to=b",
      scopeNote: "note, with comma",
    });
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-10-03T09:00:00.123Z",
      actor: {
        displayName: "Somchai",
        roleAtTime: "admin",
        membership: "current",
      },
      action: "organization.monitor.update",
      actionLabel: "แก้ไขมอนิเตอร์",
      category: "monitor",
      target: "api-prod",
      changes: [],
    });
  });

  it("is valid JSON with no events", () => {
    const parsed = JSON.parse(
      new ExportFileWriter("json", meta, 10_000).finish().content.toString(),
    ) as { events: unknown[] };
    expect(parsed.events).toEqual([]);
  });
});
