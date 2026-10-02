import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { createApp } from "../app";

const env: Env = { PORT: 4000, LOG_LEVEL: "info", NODE_ENV: "test" };
const authEnv = {} as AuthEnv;
const organizationId = crypto.randomUUID();
const eventId = crypto.randomUUID();
const exportId = crypto.randomUUID();

async function loggedPath(method: string, path: string): Promise<string> {
  const lines: string[] = [];
  const app = createApp({
    env,
    authEnv,
    logger: createLogger(
      { level: "info", name: "audit-path-logging-test" },
      { write: (line: string) => void lines.push(line) },
    ),
  });
  await app.request(path, { method });
  const entry = lines
    .map((line) => JSON.parse(line) as { msg: string; path?: string })
    .find((line) => line.msg === "request completed");
  if (!entry?.path) throw new Error("request log line missing");
  for (const secret of [organizationId, eventId, exportId]) {
    expect(lines.join("\n")).not.toContain(secret);
  }
  return entry.path;
}

describe("request log path templates for the audit log", () => {
  const base = "/api/organizations/:organizationId/audit-log";
  it.each([
    ["GET", "/events", `${base}/events`],
    ["GET", `/events/${eventId}`, `${base}/events/:eventId`],
    ["GET", "/actors", `${base}/actors`],
    ["POST", "/exports", `${base}/exports`],
    ["GET", "/exports", `${base}/exports`],
    [
      "GET",
      `/exports/${exportId}/download`,
      `${base}/exports/:exportId/download`,
    ],
  ])("%s %s", async (method, suffix, expected) => {
    expect(
      await loggedPath(
        method,
        `/api/organizations/${organizationId}/audit-log${suffix}`,
      ),
    ).toBe(expected);
  });

  it("does not log the query string", async () => {
    expect(
      await loggedPath(
        "GET",
        `/api/organizations/${organizationId}/audit-log/events?q=secret-search`,
      ),
    ).toBe(`${base}/events`);
  });
});
