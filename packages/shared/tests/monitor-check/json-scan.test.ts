import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateAssertions } from "../../src/monitor-check/assertions";
import { findAll } from "../../src/monitor-check/json-scan";
import type { NormalizedAssertion } from "../../src/monitor-check";

afterEach(() => {
  vi.restoreAllMocks();
});

const nest = (depth: number, inner: string) =>
  "[".repeat(depth) + inner + "]".repeat(depth);

describe("findAll", () => {
  it("resolves a shallow path beside a value nested past 128 levels", () => {
    const text = `{"deep":${nest(5000, "1")},"a":{"b":[10,20]}}`;
    expect(findAll(text, ["a", "b", 1])).toEqual([20]);
  });

  it("resolves a value that is itself nested past 128 levels", () => {
    expect(findAll(`{"deep":${nest(300, "7")}}`, ["deep"])).toEqual([
      JSON.parse(nest(300, "7")),
    ]);
  });

  it("returns two matches for a duplicate key at the resolved level", () => {
    expect(findAll('{"a":1,"a":2}', ["a"])).toEqual([1, 2]);
    expect(findAll('{"x":{"a":1,"a":{"b":1}}}', ["x", "a"])).toHaveLength(2);
  });

  it("follows every duplicate into the next segment", () => {
    expect(findAll('{"a":{"b":1},"a":{"b":2}}', ["a", "b"])).toEqual([1, 2]);
    expect(findAll('{"a":{"b":1},"a":{"c":2}}', ["a", "b"])).toEqual([1]);
  });

  it("ignores a duplicate key in a subtree it skips", () => {
    const text = '{"skip":{"k":1,"k":2,"n":[{"k":1,"k":2}]},"a":5}';
    expect(findAll(text, ["a"])).toEqual([5]);
  });

  it("ignores a duplicate key deeper than the resolved key", () => {
    expect(findAll('{"a":{"k":1,"k":2}}', ["a"])).toEqual([{ k: 2 }]);
  });

  it("is not fooled by brackets, quotes and escapes inside skipped strings", () => {
    const text = '{"s":"]}\\"[{","t":"\\\\","a":[1,{"a":"}"},3],"z":true}';
    expect(findAll(text, ["a", 2])).toEqual([3]);
    expect(findAll(text, ["z"])).toEqual([true]);
    expect(findAll(text, ["s"])).toEqual([']}"[{']);
  });

  it("finds nothing for a type mismatch between segment and container", () => {
    expect(findAll('{"a":[1]}', ["a", "0"])).toEqual([]);
    expect(findAll('{"a":{"0":1}}', ["a", 0])).toEqual([]);
    expect(findAll("5", ["a"])).toEqual([]);
  });

  it("handles whitespace, empty containers and an empty path", () => {
    expect(findAll(' {\n"a" : [ ] , "b" :\t{ } } ', ["b"])).toEqual([{}]);
    expect(findAll(' {"a":1} ', [])).toEqual([{ a: 1 }]);
    expect(findAll('{"a":[]}', ["a", 0])).toEqual([]);
  });
});

describe("keys", () => {
  it("resolves a key written with a unicode escape", () => {
    expect(findAll('{"a\\u0062":1}', ["ab"])).toEqual([1]);
    expect(findAll('{"\\u00e9":2}', ["é"])).toEqual([2]);
    expect(findAll('{"\\ud83d\\ude00":3}', ["😀"])).toEqual([3]);
    expect(findAll('{"a\\"b":4}', ['a"b'])).toEqual([4]);
  });

  it("returns two matches for a key spelled two ways", () => {
    expect(findAll('{"ab":1,"a\\u0062":2}', ["ab"])).toEqual([1, 2]);
  });

  it("reports multiple_matches for a duplicate key through evaluateAssertions", () => {
    const { results } = evaluate(
      [{ kind: "jsonPathEquals", pathSegments: ["ab"], expectedValue: 1 }],
      '{"ab":1,"a\\u0062":2}',
    );
    expect(results[0]).toMatchObject({
      status: "fail",
      reason: "multiple_matches",
    });
  });
});

const evaluate = (assertions: NormalizedAssertion[], body: string) =>
  evaluateAssertions(
    assertions,
    {
      status: 200,
      headers: {},
      body: Buffer.from(body),
      bodyTruncated: false,
      elapsedMs: 1,
    },
    (text) => text,
  );

describe("deep bodies through evaluateAssertions", () => {
  it("passes a JSONPath assertion on a body nested past 128 levels", () => {
    const { results } = evaluate(
      [{ kind: "jsonPathEquals", pathSegments: ["a"], expectedValue: 1 }],
      `{"deep":${nest(2000, "0")},"a":1}`,
    );
    expect(results[0]).toMatchObject({ status: "pass", reason: null });
  });

  it("resolves 200 nested segments in a body of about 1 MiB", () => {
    const segments = Array.from({ length: 200 }, () => "a");
    const body = `${'{"a":'.repeat(200)}"${"x".repeat(1024 * 1024 - 2000)}"${"}".repeat(200)}`;
    const assertions: NormalizedAssertion[] = Array.from(
      { length: 10 },
      () => ({
        kind: "jsonPathEquals",
        pathSegments: segments,
        expectedValue: "y",
      }),
    );
    const { results } = evaluate(assertions, body);
    expect(results.map((result) => result.reason)).toEqual(
      Array.from({ length: 10 }, () => "value_mismatch"),
    );
  });
});

describe("very deep matches never throw", () => {
  const scalar = (
    pathSegments: string[] = [],
  ): Extract<NormalizedAssertion, { kind: "jsonPathEquals" }> => ({
    kind: "jsonPathEquals",
    pathSegments,
    expectedValue: "x",
  });

  it("fails an empty path on a 100000-level body as type_mismatch", () => {
    const { results } = evaluate([scalar()], nest(100_000, "0"));
    expect(results[0]).toMatchObject({
      status: "fail",
      reason: "type_mismatch",
      actualType: "array",
    });
  });

  it("fails a path that lands on a 100000-level subtree as type_mismatch", () => {
    const { results } = evaluate(
      [scalar(["a", "b"])],
      `{"a":{"b":${nest(100_000, "0")}}}`,
    );
    expect(results[0]).toMatchObject({
      status: "fail",
      reason: "type_mismatch",
      actualType: "array",
    });
    expect((results[0]?.actual ?? "").length).toBeLessThanOrEqual(200);
  });
});

describe("shared parse", () => {
  it("validates the body once for several JSONPath assertions", () => {
    const body = JSON.stringify({ a: 1, b: { c: "x" }, d: [true] });
    const assertions: NormalizedAssertion[] = [
      { kind: "jsonPathEquals", pathSegments: ["a"], expectedValue: 1 },
      { kind: "jsonPathEquals", pathSegments: ["b", "c"], expectedValue: "x" },
      { kind: "jsonPathEquals", pathSegments: ["d", 0], expectedValue: true },
    ];
    const parse = vi.spyOn(JSON, "parse");
    const { results } = evaluateAssertions(
      assertions,
      {
        status: 200,
        headers: {},
        body: Buffer.from(body),
        bodyTruncated: false,
        elapsedMs: 1,
      },
      (text) => text,
    );
    expect(results.map((result) => result.status)).toEqual([
      "pass",
      "pass",
      "pass",
    ]);
    expect(parse.mock.calls.filter(([arg]) => arg === body)).toHaveLength(1);
  });
});
