import { describe, expect, it } from "vitest";

import { createEgressCanary } from "./egress-canary";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("egress canary", () => {
  it("is unknown when no canary URL is configured", async () => {
    const canary = createEgressCanary({ urls: [] });
    expect(await canary.status()).toBe("unknown");
  });

  it("is ok when any canary URL answers and failed when none does", async () => {
    const answers = new Map([
      ["https://a.example.test", false],
      ["https://b.example.test", true],
    ]);
    const probe = (url: string) => Promise.resolve(answers.get(url) ?? false);
    const some = createEgressCanary({ urls: [...answers.keys()], probe });
    expect(await some.status()).toBe("ok");

    const none = createEgressCanary({
      urls: ["https://a.example.test"],
      probe: () => Promise.resolve(false),
    });
    expect(await none.status()).toBe("failed");
  });

  it("treats a probe that throws as a failure", async () => {
    const canary = createEgressCanary({
      urls: ["https://a.example.test"],
      probe: () => Promise.reject(new Error("boom")),
    });
    expect(await canary.status()).toBe("failed");
  });

  it("caches the result for 30 seconds and shares one in-flight probe", async () => {
    const time = clock();
    let calls = 0;
    let up = false;
    const canary = createEgressCanary({
      urls: ["https://a.example.test"],
      now: time.now,
      probe: () => {
        calls += 1;
        return Promise.resolve(up);
      },
    });

    const burst = await Promise.all([
      canary.status(),
      canary.status(),
      canary.status(),
    ]);
    expect(burst).toEqual(["failed", "failed", "failed"]);
    expect(calls).toBe(1);

    up = true;
    time.advance(29_999);
    expect(await canary.status()).toBe("failed");
    expect(calls).toBe(1);

    time.advance(1);
    expect(await canary.status()).toBe("ok");
    expect(calls).toBe(2);
  });
});
