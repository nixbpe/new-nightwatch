import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  floorToMinute,
  parseAuditFilters,
  serializeAuditFilters,
  toListParams,
} from "./audit-log";

const parse = (search: string) =>
  parseAuditFilters(new URLSearchParams(search));

describe("audit list filters in the URL", () => {
  it("reads an empty query as the 7-day default", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
    expect(serializeAuditFilters(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("round-trips every filter in canonical order and never writes defaults", () => {
    const filters = parse(
      "range=custom&from=2026-09-01&to=2026-09-30&categories=member,monitor&actor=user-1&q=api-prod&page=3",
    );
    expect(filters).toEqual({
      range: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
      categories: ["monitor", "member"],
      actor: "user-1",
      q: "api-prod",
      page: 3,
    });
    expect(serializeAuditFilters(filters).toString()).toBe(
      "range=custom&from=2026-09-01&to=2026-09-30&categories=monitor%2Cmember&actor=user-1&q=api-prod&page=3",
    );
    expect(
      serializeAuditFilters({ ...DEFAULT_FILTERS, range: "7d" }).has("range"),
    ).toBe(false);
  });

  it("falls back to defaults for invalid values without throwing", () => {
    expect(
      parse("range=1y&categories=monitor,nope&page=0&q=%00bad&actor="),
    ).toEqual(DEFAULT_FILTERS);
    expect(parse("range=custom&from=2026-02-31&to=garbage")).toEqual({
      ...DEFAULT_FILTERS,
      range: "custom",
    });
    expect(parse("page=2.5").page).toBe(1);
    expect(parse(`q=${"a".repeat(101)}`).q).toBeUndefined();
  });

  it("ignores from and to unless the range is custom", () => {
    expect(parse("range=30d&from=2026-09-01")).toEqual({
      ...DEFAULT_FILTERS,
      range: "30d",
    });
  });

  it("treats all five categories as no category filter", () => {
    const all = "monitor,notification_settings,member,invitation,audit_log";
    expect(
      serializeAuditFilters(parse(`categories=${all}`)).has("categories"),
    ).toBe(false);
  });
});

describe("audit list request", () => {
  const now = new Date("2026-10-03T07:02:11.500Z");

  it("anchors a relative range at the minute and omits to and asOf", () => {
    const params = toListParams(DEFAULT_FILTERS, {
      now: floorToMinute(now),
      timeZone: "Asia/Bangkok",
    });
    expect(params).toEqual({ from: "2026-09-26T07:02:00.000Z", offset: 0 });
  });

  it("reads custom days in the preference zone and pages by 50", () => {
    const params = toListParams(
      parse(
        "range=custom&from=2026-09-26&to=2026-10-02&categories=member&actor=u&q=ada&page=3",
      ),
      { now, timeZone: "Asia/Bangkok", asOf: "2026-10-03T07:00:00.000Z" },
    );
    expect(params).toEqual({
      from: "2026-09-25T17:00:00.000Z",
      to: "2026-10-02T16:59:59.999Z",
      categories: ["member"],
      actorUserId: "u",
      q: "ada",
      asOf: "2026-10-03T07:00:00.000Z",
      offset: 100,
    });
  });
});
