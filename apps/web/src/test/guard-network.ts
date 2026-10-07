import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

export function guardUnassignedNetwork(): void {
  let previousFetch: typeof fetch;
  const escaped: string[] = [];
  beforeAll(() => {
    previousFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(rawUrl, "http://localhost");
      const endpoint = /\/monitors\/[^/]+\/(events|last-response)$/.exec(
        url.pathname,
      )?.[1];
      const path =
        endpoint === undefined
          ? "/api/<unassigned>"
          : `/api/organizations/:organizationId/monitors/:monitorId/${endpoint}`;
      const method = init?.method ?? request?.method ?? "GET";
      const error = new Error(
        `Unassigned network request in isolated unit test: ${method} ${path}`,
      );
      escaped.push(error.stack ?? error.message);
      throw error;
    };
  });
  afterEach(() => {
    // Unmount before client cancellation/clear, so live observers cannot restart requests.
    cleanup();
    expect(escaped).toEqual([]);
  });
  afterAll(() => {
    try {
      expect(escaped).toEqual([]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}
