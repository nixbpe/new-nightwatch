import type { HelloResponse } from "@nightwatch/api-contract";

export const HELLO_MESSAGE = "Hello from NightWatch";

/** Pure business logic for the hello vertical slice; no HTTP/Hono imports. */
export function getHello(now: Date = new Date()): HelloResponse {
  return { message: HELLO_MESSAGE, timestamp: now.toISOString() };
}
