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
