import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateAssertions } from "../../src/monitor-check/assertions";
import {
  findAll,
  findSpans,
  isJsonPrefix,
} from "../../src/monitor-check/json-scan";
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

describe("a prefix cut inside the document", () => {
  const scan = (text: string, path: (string | number)[]) =>
    findSpans(text, path, undefined, true);

  it("terminates and does not throw at every cut position", () => {
    const text =
      '{"a":{"b":[1,2,{"c":"x\\"yz"}]},"d":"end","e":-12.5e3,"f":true}';
    const paths: (string | number)[][] = [
      [],
      ["a"],
      ["a", "b", 2, "c"],
      ["d"],
      ["e"],
      ["f"],
      ["zz"],
      ["a", "b", 9],
    ];
    for (let cut = 0; cut <= text.length; cut++) {
      for (const path of paths) {
        expect(() => scan(text.slice(0, cut), path)).not.toThrow();
      }
    }
  });

  it("finds a value that lies completely inside the prefix", () => {
    const text = '{"a":1,"b":"abc';
    // `incomplete` is true too: a duplicate key could still follow the cut.
    expect(scan(text, ["a"])).toEqual({ spans: [[5, 6]], incomplete: true });
  });

  it.each([
    ["a string cut in the middle", '{"a":1,"b":"abc', ["b"]],
    ["a number that may be cut", '{"a":12', ["a"]],
    ["a key not yet reached", '{"a":1,"b":2', ["c"]],
    ["a key cut in the middle", '{"a":1,"bb', ["b"]],
    ["a value not started", '{"a":', ["a"]],
    ["an array index not reached", '{"a":[1,2', ["a", 5]],
    ["a cut inside a skipped container", '{"x":{"y":[1,{"z":', ["w"]],
  ])("reports %s as incomplete with no span", (_name, text, path) => {
    expect(scan(text, path)).toEqual({ spans: [], incomplete: true });
  });

  it("keeps a cut container as a span so its type is known", () => {
    const text = '{"a":[1,2';
    const { spans } = scan(text, ["a"]);
    expect(spans).toEqual([[5, text.length]]);
  });

  it("does not call a complete document incomplete", () => {
    expect(findSpans('{"a":1}', ["b"])).toEqual({
      spans: [],
      incomplete: false,
    });
    expect(findSpans('{"a":1}', ["a"], undefined, true).spans).toHaveLength(1);
  });
});

describe("isJsonPrefix", () => {
  const sample =
    '{"a":{"b":[1,2,{"c":"x\\"y\\u00e9z"}]},"d":"end","e":-12.5e3,"f":true,"g":null,"h":[],"i":{}}';

  it("accepts every prefix of a valid document", () => {
    for (let cut = 0; cut <= sample.length; cut++) {
      expect(isJsonPrefix(sample.slice(0, cut)), sample.slice(0, cut)).toBe(
        true,
      );
    }
  });

  it.each([
    "{'a':1",
    "{a:1",
    "404 Not Found",
    '[a"b,"]",[',
    '{"a":1}{"b":2}',
    '{"a":1}\n{"b":2}',
    "[1]\n[2]",
    "1 2",
    '"a" "b"',
    "[1,]",
    '{"a":1,}',
    "{,}",
    '{"a" 1}',
    '{"a":}',
    "[1 2]",
    '{"a":01}',
    "[01]",
    "-x",
    "1.x",
    "1ee",
    "1e+x",
    "tru3",
    "nulx",
    '"\\x"',
    '"\\u12g4"',
    '"a\nb"',
    "<html>",
    "]",
    "}",
    '{"a":1]',
    "[1}",
  ])("rejects %j", (text) => {
    expect(isJsonPrefix(text)).toBe(false);
  });

  it.each([
    "",
    "  ",
    "-",
    "1.",
    "1e",
    "1e+",
    "tr",
    "nu",
    '"abc',
    '{"a',
    '{"a":',
    "[",
    "[1,",
    '{"a":1,',
  ])("accepts the prefix %j", (text) => {
    expect(isJsonPrefix(text)).toBe(true);
  });

  it("accepts whatever JSON.parse accepts, and is linear on a long body", () => {
    const big = `[${"1,".repeat(500_000)}1]`;
    expect(isJsonPrefix(big)).toBe(true);
    expect(isJsonPrefix("[".repeat(300_000))).toBe(true);
  });
});

describe("malformed text never hangs or escapes as anything but SyntaxError", () => {
  // Deterministic LCG so a failure reproduces.
  let seed = 12345;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const alphabet = '{}[]",:\\ 01a-.etrufnl\n';
  const random = () =>
    Array.from({ length: next(40) }, () =>
      alphabet.charAt(next(alphabet.length)),
    ).join("");
  const paths: (string | number)[][] = [
    [],
    ["a"],
    ["a", 0],
    [0],
    ["a", "b"],
    [1, "a"],
  ];

  it("holds for random text, with and without the validity check", () => {
    for (let round = 0; round < 3000; round++) {
      const text = random();
      let parsed = true;
      try {
        JSON.parse(text);
      } catch {
        parsed = false;
      }
      const prefix = isJsonPrefix(text);
      if (parsed) expect(prefix, text).toBe(true);
      for (const path of paths) {
        try {
          findSpans(text, path, undefined, true);
        } catch (error) {
          expect(error, text).toBeInstanceOf(SyntaxError);
        }
        if (prefix) {
          expect(
            () => findSpans(text, path, undefined, true),
            text,
          ).not.toThrow();
        }
      }
    }
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

// Correctness, not speed: a loaded CI runner can take seconds for these bodies.
describe("deep bodies through evaluateAssertions", { timeout: 30_000 }, () => {
  it("passes a JSONPath assertion on a body nested past 128 levels", () => {
    const { results } = evaluate(
      [{ kind: "jsonPathEquals", pathSegments: ["a"], expectedValue: 1 }],
      `{"deep":${nest(2000, "0")},"a":1}`,
    );
    expect(results[0]).toMatchObject({ status: "pass", reason: null });
  });

  it("resolves 200 nested segments in a body of about 256 KiB", () => {
    const segments = Array.from({ length: 200 }, () => "a");
    const body = `${'{"a":'.repeat(200)}"${"x".repeat(256 * 1024)}"${"}".repeat(200)}`;
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

describe("very deep matches never throw", { timeout: 30_000 }, () => {
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
