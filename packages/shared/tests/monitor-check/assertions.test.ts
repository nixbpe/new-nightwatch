import { afterEach, describe, expect, it } from "vitest";

import { evaluateAssertions } from "../../src/monitor-check/assertions";
import {
  createRedactor,
  runCheck,
  type AssertionResult,
  type NormalizedAssertion,
} from "../../src/monitor-check";
import type { RawServer } from "../outbound-http/fixtures";
import { configFor, deps, first, serveReplies, type Reply } from "./fixtures";

const servers: RawServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const jsonPath = (
  path: (string | number)[],
  expectedValue: string | number | boolean | null,
): NormalizedAssertion => ({
  kind: "jsonPathEquals",
  pathSegments: path,
  expectedValue,
});

async function assertOnce(
  reply: Reply,
  assertion: NormalizedAssertion,
): Promise<{ assertion: AssertionResult; prefix: boolean }> {
  const server = await serveReplies(() => reply);
  servers.push(server);
  const result = await runCheck(
    configFor("http", server.port, { assertions: [assertion] }),
    {},
    deps(),
  );
  return {
    assertion: first(result.assertions),
    prefix: result.evaluatedFromPrefix,
  };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

describe("body assertions against real responses (AC-33)", () => {
  it.each<[string, Reply, NormalizedAssertion, string | null]>([
    [
      "204 with jsonPath",
      { status: "204 No Content" },
      jsonPath(["a"], 1),
      "no_body",
    ],
    [
      "204 with bodyContains",
      { status: "204 No Content" },
      { kind: "bodyContains", text: "x" },
      "no_body",
    ],
    [
      "non-JSON body",
      { body: "<html>hi</html>" },
      jsonPath(["a"], 1),
      "not_json",
    ],
    [
      "path not found",
      { headers: JSON_HEADERS, body: '{"a":{"b":1}}' },
      jsonPath(["a", "c"], 1),
      "path_not_found",
    ],
    [
      "index beyond the array",
      { headers: JSON_HEADERS, body: '{"a":[1]}' },
      jsonPath(["a", 1], 1),
      "path_not_found",
    ],
    [
      "duplicate key reaches two values",
      { headers: JSON_HEADERS, body: '{"a":1,"a":2}' },
      jsonPath(["a"], 2),
      "multiple_matches",
    ],
    [
      'string "1" against number 1',
      { headers: JSON_HEADERS, body: '{"n":"1"}' },
      jsonPath(["n"], 1),
      "type_mismatch",
    ],
    [
      'number 1 against string "1"',
      { headers: JSON_HEADERS, body: '{"n":1}' },
      jsonPath(["n"], "1"),
      "type_mismatch",
    ],
    [
      "object against a scalar",
      { headers: JSON_HEADERS, body: '{"n":{"x":1}}' },
      jsonPath(["n"], "x"),
      "type_mismatch",
    ],
    [
      "plain-text expected matches",
      { headers: JSON_HEADERS, body: '{"status":"ok"}' },
      jsonPath(["status"], "ok"),
      null,
    ],
    [
      "plain-text expected differs",
      { headers: JSON_HEADERS, body: '{"status":"degraded"}' },
      jsonPath(["status"], "ok"),
      "value_mismatch",
    ],
    [
      "null value matches null",
      { headers: JSON_HEADERS, body: '{"x":null}' },
      jsonPath(["x"], null),
      null,
    ],
    [
      "nested array index",
      { headers: JSON_HEADERS, body: '{"a":[{"b":true}]}' },
      jsonPath(["a", 0, "b"], true),
      null,
    ],
    [
      "unsupported charset",
      {
        headers: { "Content-Type": "text/plain; charset=shift_jis" },
        body: "ok",
      },
      { kind: "bodyContains", text: "ok" },
      "undecodable",
    ],
    [
      "invalid utf-8 bytes",
      { body: Buffer.from([0x6f, 0xff, 0x6b]) },
      { kind: "bodyContains", text: "o" },
      "undecodable",
    ],
    [
      "us-ascii with a high byte",
      {
        headers: { "Content-Type": "text/plain; charset=US-ASCII" },
        body: Buffer.from([0x6f, 0xe9]),
      },
      { kind: "bodyContains", text: "o" },
      "undecodable",
    ],
    [
      "iso-8859-1 text",
      {
        headers: { "Content-Type": "text/plain; charset=ISO-8859-1" },
        body: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
      },
      { kind: "bodyContains", text: "café" },
      null,
    ],
    [
      "utf8 alias",
      { headers: { "Content-Type": "text/plain; charset=UTF8" }, body: "ok" },
      { kind: "bodyContains", text: "ok" },
      null,
    ],
    [
      "ascii alias",
      { headers: { "Content-Type": "text/plain; charset=ascii" }, body: "ok" },
      { kind: "bodyContains", text: "ok" },
      null,
    ],
    [
      "latin1 alias",
      {
        headers: { "Content-Type": "text/plain; charset=Latin1" },
        body: Buffer.from([0x63, 0xe9]),
      },
      { kind: "bodyContains", text: "cé" },
      null,
    ],
    [
      "windows-1252 stays undecodable",
      {
        headers: { "Content-Type": "text/plain; charset=windows-1252" },
        body: "ok",
      },
      { kind: "bodyContains", text: "ok" },
      "undecodable",
    ],
    [
      "body without the text",
      { body: "hello" },
      { kind: "bodyContains", text: "bye" },
      "text_not_found",
    ],
  ])("%s", async (_name, reply, assertion, reason) => {
    const { assertion: result } = await assertOnce(reply, assertion);
    expect(result.reason).toBe(reason);
    expect(result.status).toBe(reason === null ? "pass" : "fail");
  });

  it("reports the JSON type of the actual value on a type mismatch", async () => {
    const { assertion } = await assertOnce(
      { headers: JSON_HEADERS, body: '{"n":"1"}' },
      jsonPath(["n"], 1),
    );
    expect(assertion).toMatchObject({
      expected: "1",
      actual: '"1"',
      actualType: "string",
    });
  });

  it("evaluates a body over 1 MiB from its prefix and flags it", async () => {
    const filler = "x".repeat(1024 * 1024);
    const atEnd = await assertOnce(
      { body: `${filler}NEEDLE` },
      { kind: "bodyContains", text: "NEEDLE" },
    );
    expect(atEnd.assertion.reason).toBe("text_not_found");
    expect(atEnd.prefix).toBe(true);

    const atStart = await assertOnce(
      { body: `NEEDLE${filler}` },
      { kind: "bodyContains", text: "NEEDLE" },
    );
    expect(atStart.assertion.status).toBe("pass");
    expect(atStart.prefix).toBe(true);
  });

  it.each([
    ["2-byte", "é", 1],
    ["3-byte, one byte in", "€", 1],
    ["3-byte, two bytes in", "€", 2],
  ])(
    "does not call a %s character cut by the 1 MiB limit undecodable",
    async (_name, char, bytesKept) => {
      const kept = 1024 * 1024 - bytesKept;
      const { assertion, prefix } = await assertOnce(
        { body: `${"x".repeat(kept)}${char}tail` },
        { kind: "bodyContains", text: "xxx" },
      );
      expect(assertion).toMatchObject({ status: "pass", reason: null });
      expect(prefix).toBe(true);
    },
  );

  it("still calls invalid utf-8 inside the read prefix undecodable", async () => {
    const { assertion } = await assertOnce(
      {
        body: Buffer.concat([
          Buffer.from([0xff]),
          Buffer.from("x".repeat(1024 * 1024 + 10)),
        ]),
      },
      { kind: "bodyContains", text: "x" },
    );
    expect(assertion.reason).toBe("undecodable");
  });

  describe("JSONPath on a body cut at 1 MiB", () => {
    const pad = "x".repeat(1.2 * 1024 * 1024);
    const status = (expectedValue: string): NormalizedAssertion =>
      jsonPath(["status"], expectedValue);

    it("passes when the value is inside the prefix and matches", async () => {
      const { assertion, prefix } = await assertOnce(
        { headers: JSON_HEADERS, body: `{"status":"ok","pad":"${pad}"}` },
        status("ok"),
      );
      expect(assertion).toMatchObject({ status: "pass", reason: null });
      expect(prefix).toBe(true);
    });

    it("fails with the real mismatch when the value is inside the prefix", async () => {
      const { assertion, prefix } = await assertOnce(
        { headers: JSON_HEADERS, body: `{"status":"bad","pad":"${pad}"}` },
        status("ok"),
      );
      expect(assertion).toMatchObject({
        status: "fail",
        reason: "value_mismatch",
        actual: '"bad"',
      });
      expect(prefix).toBe(true);
    });

    it("is not evaluated, not not_json, when the path lies beyond the cut", async () => {
      const { assertion, prefix } = await assertOnce(
        { headers: JSON_HEADERS, body: `{"pad":"${pad}","status":"ok"}` },
        status("ok"),
      );
      expect(assertion).toMatchObject({
        status: "not_evaluated",
        reason: "prefix_ended",
      });
      expect(prefix).toBe(true);
    });

    it("is not evaluated when the cut falls inside the matched string", async () => {
      const { assertion } = await assertOnce(
        { headers: JSON_HEADERS, body: `{"pad":"a","status":"${pad}"}` },
        status("ok"),
      );
      expect(assertion).toMatchObject({
        status: "not_evaluated",
        reason: "prefix_ended",
      });
    });

    it("still reports not_json for a truncated body that does not start like JSON", async () => {
      const { assertion } = await assertOnce(
        { body: `<html>${pad}</html>` },
        status("ok"),
      );
      expect(assertion).toMatchObject({ status: "fail", reason: "not_json" });
    });

    it.each([
      ["a single-quoted key", "{'a':1,"],
      ["an unquoted key", "{a:1,"],
      ["a plain-text error page", "404 Not Found "],
      ["a malformed array", '[a"b,"]",['],
      ["NDJSON", '{"status":"ok"}\n{"status":"ok"}\n'],
      ["concatenated values", '{"status":"ok"}{"status":"ok"}'],
    ])("reports not_json for a truncated body of %s", async (_name, start) => {
      const { assertion } = await assertOnce(
        { body: `${start}${pad}` },
        status("ok"),
      );
      expect(assertion).toMatchObject({ status: "fail", reason: "not_json" });
    });

    it("reads a truncated 404 page as text, not as the number 404", async () => {
      const { assertion } = await assertOnce(
        { body: `404 Not Found ${pad}` },
        { kind: "jsonPathEquals", pathSegments: [], expectedValue: 404 },
      );
      expect(assertion).toMatchObject({ status: "fail", reason: "not_json" });
    });

    it("is not evaluated when a later duplicate key could still supply the path", async () => {
      const { assertion } = await assertOnce(
        { headers: JSON_HEADERS, body: `{"a":{"b":1},"pad":"${pad}"}` },
        jsonPath(["a", "c"], 1),
      );
      expect(assertion).toMatchObject({
        status: "not_evaluated",
        reason: "prefix_ended",
      });
    });
  });

  it("still reports not_json for a small body that is not JSON", async () => {
    const { assertion } = await assertOnce(
      { body: "not json at all" },
      jsonPath(["a"], 1),
    );
    expect(assertion).toMatchObject({ status: "fail", reason: "not_json" });
  });

  it("does not flag a body within 1 MiB", async () => {
    const { prefix } = await assertOnce(
      { body: "small" },
      { kind: "bodyContains", text: "small" },
    );
    expect(prefix).toBe(false);
  });
});

describe("response time assertion", () => {
  const response = (elapsedMs: number) => ({
    status: 200,
    headers: {},
    body: Buffer.from("ok"),
    bodyTruncated: false,
    elapsedMs,
  });
  const run = (ms: number, elapsedMs: number) =>
    first(
      evaluateAssertions(
        [{ kind: "responseTimeBelow", ms }],
        response(elapsedMs),
        (text) => text,
      ).results,
    );

  it("fails when the response time equals the threshold", () => {
    expect(run(500, 500)).toMatchObject({
      status: "fail",
      reason: "too_slow",
      actual: "500",
    });
  });

  it("passes below the threshold and fails above it", () => {
    expect(run(500, 499)).toMatchObject({ status: "pass", reason: null });
    expect(run(500, 501)).toMatchObject({ status: "fail", reason: "too_slow" });
  });
});

describe("actual value cut (AC-17)", () => {
  const evaluate = (value: string, redact = (text: string) => text) =>
    first(
      evaluateAssertions(
        [jsonPath(["v"], "never")],
        {
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify({ v: value })),
          bodyTruncated: false,
          elapsedMs: 1,
        },
        redact,
      ).results,
    );

  // The shown value is JSON text, so the two quotes count toward the 200.
  it("keeps 200 characters whole and marks nothing", () => {
    const result = evaluate("a".repeat(198));
    expect(result.actual).toHaveLength(200);
    expect(result.actualTruncated).toBe(false);
  });

  it("cuts 201 characters to 200 and marks it", () => {
    const result = evaluate("a".repeat(199));
    expect(result.actual).toHaveLength(200);
    expect(result.actualTruncated).toBe(true);
  });

  it("masks a secret that straddles the cut before cutting", () => {
    const secret = "S3CR3T-VALUE";
    const value = `${"a".repeat(195)}${secret}tail`;
    const result = evaluate(value, createRedactor([secret]));
    expect(result.actual).not.toMatch(/S3CR|3T-V|VALUE/);
    expect(result.actual).toContain("•••");
    expect(result.actualTruncated).toBe(true);
  });

  it("marks the actual as truncated when the redactor ran out of budget", () => {
    const result = evaluate(
      "a".repeat(1 << 20),
      createRedactor(["a".repeat(4096)]),
    );
    expect(result.actual).toBe('"•••');
    expect(result.actualTruncated).toBe(true);
  });
});
