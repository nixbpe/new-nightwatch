import { describe, expect, it } from "vitest";

import { assertSameOrigin, planSecrets, type SecretEntry } from "./secrets";

const at = (
  url: string,
  queryParams: { name: string; value: string }[] = [],
) => ({
  url,
  queryParams,
});

function origins(from: string, to: string): "same" | "changed" {
  try {
    assertSameOrigin(at(from), at(to));
    return "same";
  } catch (error) {
    expect(error).toMatchObject({
      statusCode: 422,
      code: "MONITOR_SECRET_ORIGIN_CHANGED",
    });
    return "changed";
  }
}

describe("assertSameOrigin (AC-44)", () => {
  it.each([
    ["path only", "http://a.example/x", "http://a.example/y"],
    ["query only", "http://a.example/x?a=1", "http://a.example/x?b=2"],
    ["default port 80 explicit", "http://a.example/", "http://a.example:80/"],
    [
      "default port 443 explicit",
      "https://a.example/",
      "https://a.example:443/",
    ],
    ["host case", "https://A.Example/", "https://a.example/"],
    [
      "punycode form of an IDN host",
      "https://bücher.example/",
      "https://xn--bcher-kva.example/",
    ],
    [
      "IPv6 literal spelling",
      "http://[2606:4700::1]:8080/",
      "http://[2606:4700:0:0:0:0:0:1]:8080/",
    ],
  ])("treats %s as the same origin", (_label, from, to) => {
    expect(origins(from, to)).toBe("same");
  });

  it.each([
    ["scheme", "http://a.example/", "https://a.example/"],
    ["host", "https://a.example/", "https://b.example/"],
    ["port", "https://a.example:8443/", "https://a.example:9443/"],
    [
      "implicit to non-default port",
      "https://a.example/",
      "https://a.example:8443/",
    ],
    ["a trailing dot on the host", "https://a.example/", "https://a.example./"],
    ["a subdomain", "https://a.example/", "https://www.a.example/"],
  ])("treats a change of %s as a new origin", (_label, from, to) => {
    expect(origins(from, to)).toBe("changed");
  });

  it("counts a query param added to the check URL as path-level, not origin", () => {
    expect(() => {
      assertSameOrigin(
        at("https://a.example/"),
        at("https://a.example/", [{ name: "k", value: "v" }]),
      );
    }).not.toThrow();
  });

  it("compares the origin of a forbidden address instead of calling it changed", () => {
    expect(origins("http://10.0.0.5:8080/a", "http://10.0.0.5:8080/b")).toBe(
      "same",
    );
    expect(origins("http://10.0.0.5:8080/", "http://10.0.0.6:8080/")).toBe(
      "changed",
    );
  });

  it("treats a URL the executor would refuse as changed, never as safe", () => {
    expect(origins("https://a.example/", "https://user:pw@a.example/")).toBe(
      "changed",
    );
    expect(origins("https://a.example/", "ftp://a.example/")).toBe("changed");
    expect(origins("not a url", "https://a.example/")).toBe("changed");
  });
});

const HEADER = "5b0c1a3e-6f0a-4a57-9c4e-8d1b2a3c4d5e";
const bearer = [{ slot: "auth.token", field: "auth" }];
const entry = (
  slot: string,
  action: SecretEntry["action"],
  value?: string,
): SecretEntry => ({ slot, action, ...(value === undefined ? {} : { value }) });

function fieldsOf(run: () => unknown): { field: string; reason: string }[] {
  try {
    run();
  } catch (error) {
    return (
      error as { details: { fields: { field: string; reason: string }[] } }
    ).details.fields;
  }
  return [];
}

describe("planSecrets (AC-26, AC-46)", () => {
  const plan = (
    entries: SecretEntry[],
    stored: string[] = [],
    required = bearer,
    mode: "save" | "test" = "save",
  ) => planSecrets({ required, entries, stored: new Set(stored), mode });

  it("sorts entries into writes, keeps and stale deletes", () => {
    expect(
      plan(
        [entry("auth.token", "replace", "v")],
        ["auth.token", "auth.apiKey"],
      ),
    ).toEqual({
      writes: [{ slot: "auth.token", value: "v" }],
      keeps: [],
      deletes: ["auth.apiKey"],
    });
    expect(plan([entry("auth.token", "keep")], ["auth.token"])).toEqual({
      writes: [],
      keeps: ["auth.token"],
      deletes: [],
    });
  });

  it("accepts delete of a slot the config no longer needs, present or not", () => {
    const none = { required: [] as typeof bearer };
    expect(
      plan([entry("auth.token", "delete")], ["auth.token"], none.required)
        .deletes,
    ).toEqual(["auth.token"]);
    expect(
      plan([entry("auth.token", "delete")], [], none.required).deletes,
    ).toEqual([]);
  });

  it("reports each violation at its documented field", () => {
    expect(
      fieldsOf(() => plan([entry("auth.token", "delete")], ["auth.token"])),
    ).toEqual([
      { field: "secrets.0.slot", reason: "required" },
      { field: "auth", reason: "required" },
    ]);
    expect(fieldsOf(() => plan([entry("auth.token", "keep")], []))).toEqual([
      { field: "secrets.0", reason: "required" },
    ]);
    expect(
      fieldsOf(() => plan([entry("auth.password", "replace", "x")])),
    ).toContainEqual({ field: "secrets.0.slot", reason: "invalid_format" });
    expect(fieldsOf(() => plan([]))).toEqual([
      { field: "auth", reason: "required" },
    ]);
    expect(
      fieldsOf(() =>
        plan([], [], [{ slot: `header.${HEADER}`, field: "headers.3.value" }]),
      ),
    ).toEqual([{ field: "headers.3.value", reason: "required" }]);
  });

  it("compares a header slot by its lowercase id", () => {
    const required = [{ slot: `header.${HEADER}`, field: "headers.0.value" }];
    expect(
      plan(
        [entry(`header.${HEADER.toUpperCase()}`, "replace", "v")],
        [],
        required,
      ).writes,
    ).toEqual([{ slot: `header.${HEADER}`, value: "v" }]);
  });

  it("leaves a missing or unstored slot to the executor in test mode", () => {
    expect(plan([], [], bearer, "test").writes).toEqual([]);
    expect(
      plan([entry("auth.token", "keep")], [], bearer, "test").keeps,
    ).toEqual(["auth.token"]);
    expect(
      fieldsOf(() =>
        plan([entry("auth.nope", "replace", "x")], [], bearer, "test"),
      ),
    ).toEqual([{ field: "secrets.0.slot", reason: "invalid_format" }]);
  });
});
