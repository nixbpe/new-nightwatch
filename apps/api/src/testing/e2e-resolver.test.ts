import { lookup } from "node:dns/promises";
import type * as Dns from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import { sendOutboundRequest } from "@nightwatch/shared";

import { e2eResolver } from "./e2e-resolver";

vi.mock("node:dns/promises", async (importOriginal) => {
  const original = await importOriginal<typeof Dns>();
  return { ...original, lookup: vi.fn(original.lookup) };
});

describe("E2E DNS boundary fixture", () => {
  it("classifies the reserved hostname through the real outbound executor", async () => {
    vi.mocked(lookup).mockClear();
    const result = await sendOutboundRequest(
      {
        url: "http://dns-not-found.nw-e2e.invalid/",
        method: "GET",
        headers: {},
        timeoutMs: 1_000,
        maxRedirects: 0,
        secretHeaderNames: [],
        maxBodyBytes: 1024,
      },
      { resolver: e2eResolver },
    );
    expect(result.failure?.reason).toBe("dns_not_found");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("delegates other hostnames to the real resolver", async () => {
    const records = await lookup("localhost", { all: true, verbatim: true });
    expect(await e2eResolver("localhost")).toEqual(
      records.map((record) => record.address),
    );
  });
});
