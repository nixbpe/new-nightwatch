import { describe, expect, it } from "vitest";

import { createEgressCanary } from "./egress-canary";
import {
  closedPort,
  outboundDeps,
  startTarget,
  TARGET_HOST,
} from "./test-harness";

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

  it("an aborted shutdown signal skips the probe and reads unknown", async () => {
    let probes = 0;
    const controller = new AbortController();
    const canary = createEgressCanary({
      urls: ["https://canary.example.test"],
      signal: controller.signal,
      probe: () => {
        probes += 1;
        return Promise.resolve(false);
      },
    });
    controller.abort();
    expect(await canary.status()).toBe("unknown");
    expect(probes).toBe(0);
  });
});

describe("egress canary against real outbound HTTP", () => {
  it("probes the canary URL through the SSRF helper", async () => {
    const answering = await startTarget();
    try {
      const up = createEgressCanary({
        urls: [`${answering.url}/ping`],
        outbound: outboundDeps,
      });
      expect(await up.status()).toBe("ok");
      expect(answering.requests[0]?.method).toBe("HEAD");
    } finally {
      await answering.close();
    }
    const port = await closedPort();
    const down = createEgressCanary({
      urls: [`http://target.nw-test.internal:${String(port)}/`],
      outbound: outboundDeps,
    });
    expect(await down.status()).toBe("failed");
    // A canary URL that resolves to a forbidden address is refused, never contacted.
    const blocked = createEgressCanary({
      urls: ["http://blocked.example.test:8080/"],
      outbound: { resolver: () => Promise.resolve(["127.0.0.1"]) },
    });
    expect(await blocked.status()).toBe("failed");
  });

  it("counts a redirecting or looping canary URL as answering, without following it", async () => {
    // The redirect destination is a dead port: following it would turn this
    // "failed", so "ok" here proves the canary trusts the hop and stops.
    const dead = await closedPort();
    const target = await startTarget((request, response) => {
      if (request.url === "/loop") {
        response.statusCode = 302;
        response.setHeader("location", "/loop");
      } else if (request.url === "/hop") {
        response.statusCode = 302;
        response.setHeader(
          "location",
          `http://${TARGET_HOST}:${String(dead)}/`,
        );
      } else {
        response.statusCode = 200;
      }
      response.end();
    });
    try {
      for (const path of ["/hop", "/loop"]) {
        const canary = createEgressCanary({
          urls: [`${target.url}${path}`],
          outbound: outboundDeps,
        });
        expect(await canary.status()).toBe("ok");
      }
      expect(target.requests).toHaveLength(2);
    } finally {
      await target.close();
    }
  });
});
