import { helloResponseSchema } from "@nightwatch/api-contract";
import { describe, expect, it } from "vitest";

import { getHello, HELLO_MESSAGE } from "./service";

describe("getHello", () => {
  it("returns the greeting stamped with the injected clock", () => {
    const result = getHello(new Date("2026-09-06T12:00:00.000Z"));
    expect(result.message).toBe(HELLO_MESSAGE);
    expect(result.timestamp).toBe("2026-09-06T12:00:00.000Z");
  });

  it("produces a payload that satisfies the api-contract schema", () => {
    expect(helloResponseSchema.safeParse(getHello()).success).toBe(true);
  });
});
