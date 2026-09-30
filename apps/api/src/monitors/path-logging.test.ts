import { createLogger, type AuthEnv, type Env } from "@nightwatch/shared";
import { describe, expect, it } from "vitest";

import { createApp } from "../app";

const env: Env = { PORT: 4000, LOG_LEVEL: "info", NODE_ENV: "test" };
const authEnv = {} as AuthEnv;
const organizationId = crypto.randomUUID();
const monitorId = crypto.randomUUID();

async function loggedPath(method: string, path: string): Promise<string> {
  const lines: string[] = [];
  const app = createApp({
    env,
    authEnv,
    logger: createLogger(
      { level: "info", name: "path-logging-test" },
      { write: (line: string) => void lines.push(line) },
    ),
  });
  await app.request(path, { method });
  const entry = lines
    .map((line) => JSON.parse(line) as { msg: string; path?: string })
    .find((line) => line.msg === "request completed");
  if (!entry?.path) throw new Error("request log line missing");
  expect(lines.join("\n")).not.toContain(monitorId);
  expect(lines.join("\n")).not.toContain(organizationId);
  return entry.path;
}

describe("request log path templates for monitors", () => {
  const base = "/api/organizations/:organizationId/monitors";

  it.each([
    ["GET", `/monitors`, base],
    ["POST", `/monitors/test`, `${base}/test`],
    ["GET", `/monitors/recent-events`, `${base}/recent-events`],
    ["GET", `/monitors/${monitorId}`, `${base}/:monitorId`],
    ["PATCH", `/monitors/${monitorId}`, `${base}/:monitorId`],
    ["DELETE", `/monitors/${monitorId}`, `${base}/:monitorId`],
    ["POST", `/monitors/${monitorId}/pause`, `${base}/:monitorId/pause`],
    ["POST", `/monitors/${monitorId}/resume`, `${base}/:monitorId/resume`],
    ["POST", `/monitors/${monitorId}/test`, `${base}/:monitorId/test`],
    ["GET", `/monitors/${monitorId}/checks`, `${base}/:monitorId/checks`],
    ["GET", `/monitors/${monitorId}/incidents`, `${base}/:monitorId/incidents`],
    [
      "GET",
      `/monitors/${monitorId}/response-times`,
      `${base}/:monitorId/response-times`,
    ],
    ["GET", `/monitors/${monitorId}/other`, `${base}/:monitorId/:segment`],
    ["GET", `/monitors/test/extra`, `${base}/test/:segment`],
  ])("%s %s is logged as its template", async (method, suffix, expected) => {
    expect(
      await loggedPath(method, `/api/organizations/${organizationId}${suffix}`),
    ).toBe(expected);
  });
});
