import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);

test("Turbo strict children receive the explicit PostgreSQL binding only for supported tasks", () => {
  const directory = mkdtempSync(join(tmpdir(), "nw-turbo-env-"));
  try {
    mkdirSync(join(directory, "packages/probe"), { recursive: true });
    writeFileSync(
      join(directory, "turbo.json"),
      readFileSync(new URL("turbo.json", root)),
    );
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "environment-probe",
        private: true,
        packageManager: "bun@1.4.3",
        workspaces: ["packages/*"],
      }),
    );
    const tasks = ["test:coverage", "test:integration", "test"];
    writeFileSync(
      join(directory, "packages/probe/package.json"),
      JSON.stringify({
        name: "probe",
        scripts: Object.fromEntries(
          tasks.map((task) => [task, "bun probe.mjs"]),
        ),
      }),
    );
    writeFileSync(
      join(directory, "packages/probe/probe.mjs"),
      `
      console.log("BINDING=" + (process.env.TEST_POSTGRES_CONTAINER ?? "absent"));
      console.log("UNRELATED=" + (process.env.NW_UNRELATED_PROBE ?? "absent"));
    `,
    );
    const install = spawnSync("bun", ["install", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
    });
    expect(install.status).toBe(0);
    for (const task of tasks) {
      const result = spawnSync(
        new URL("node_modules/.bin/turbo", root).pathname,
        ["run", task, "--env-mode=strict", "--force"],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            TEST_POSTGRES_CONTAINER: "a".repeat(64),
            NW_UNRELATED_PROBE: "must-not-leak",
            TURBO_TELEMETRY_DISABLED: "1",
          },
        },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        `BINDING=${task === "test" ? "absent" : "a".repeat(64)}`,
      );
      expect(result.stdout).toContain("UNRELATED=absent");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
