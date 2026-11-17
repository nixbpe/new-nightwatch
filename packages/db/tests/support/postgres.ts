import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createDatabase, type Database } from "../../src/client";
import {
  listMigrations,
  runMigrations,
  type MigrationResult,
} from "../../src/migrator";

export type MigrationTarget = "latest" | `${number}_${string}.sql`;
export type TestDatabaseUrls = Readonly<{
  runtimeUrl: string;
  ownerUrl: string;
}>;
export type TestPostgres = {
  readonly runtime: Database;
  readonly owner: Database;
  readonly urls: TestDatabaseUrls;
  advanceTo(target: MigrationTarget): Promise<MigrationResult>;
  close(): Promise<void>;
};

const migrationsDir = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);
const initRolesScript = fileURLToPath(
  new URL("../../../../scripts/db/init/001-roles.sh", import.meta.url),
);
const ownershipLabel = "nightwatch.test-postgres";

function waitForResult<T>(
  pending: Promise<T>,
  milliseconds: number,
  resource: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        reject(new Error(`${resource} timed out; operation not drained`));
      },
      Math.max(1, milliseconds),
    );
    pending.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

function docker(
  args: [string, ...string[]],
  milliseconds = 20_000,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const stdout: Buffer[] = [];
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
        reapTimer = setTimeout(() => {
          reject(new Error(`docker ${args[0]} timed out; child not reaped`));
        }, 1_000);
      },
      Math.max(1, milliseconds),
    );
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error(`docker ${args[0]} could not start`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      if (timedOut) reject(new Error(`docker ${args[0]} timed out`));
      else if (code !== 0) reject(new Error(`docker ${args[0]} failed`));
      else resolve(Buffer.concat(stdout).toString());
    });
  });
}

export async function openTestPostgres(
  label: string,
  through: MigrationTarget = "latest",
): Promise<TestPostgres> {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(label))
    throw new Error("Invalid PostgreSQL fixture label");
  const canonical = await listMigrations(migrationsDir);
  function targetIndex(target: MigrationTarget): number {
    const index =
      target === "latest"
        ? canonical.length - 1
        : canonical.findIndex(({ name }) => name === target);
    if (index < 0) throw new Error(`Unknown canonical migration: ${target}`);
    return index;
  }
  const initialIndex = targetIndex(through);
  const run = randomUUID();
  const container = `nightwatch-test-${label}-${run}`;
  const ownerPassword = randomUUID();
  const runtimePassword = randomUUID();
  let prefix: string | undefined;
  let copiedIndex = -1;
  let currentIndex = -1;
  let owner: Database | undefined;
  let runtime: Database | undefined;
  let replay: Promise<MigrationResult> | undefined;
  let advancing: Promise<MigrationResult> | undefined;
  let failed = false;
  let closing: Promise<void> | undefined;
  const setupDeadline = Date.now() + 90_000;

  async function removeContainer(deadline: number): Promise<void> {
    const command = (args: [string, ...string[]]) =>
      docker(args, Math.min(10_000, deadline - Date.now()));
    try {
      const ids = await command([
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${container}$`,
      ]);
      if (ids.trim()) {
        const identity = await command([
          "inspect",
          "--format",
          `{{index .Config.Labels "${ownershipLabel}"}}`,
          container,
        ]);
        if (identity.trim() !== run)
          throw new Error("ownership label mismatch");
        await command(["rm", "--force", "--volumes", container]);
      }
      const remaining = await command([
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `name=^/${container}$`,
      ]);
      if (remaining.trim()) throw new Error("still present");
    } catch (cause) {
      throw new Error(`Unresolved owned container ${container}`, { cause });
    }
  }

  function close(): Promise<void> {
    closing ??= (async () => {
      const errors: unknown[] = [];
      const deadline = Date.now() + 30_000;
      async function attempt(resource: string, action: () => Promise<unknown>) {
        try {
          await waitForResult(
            action(),
            Math.min(5_000, deadline - Date.now()),
            resource,
          );
        } catch (cause) {
          errors.push(new Error(`Cleanup failed for ${resource}`, { cause }));
        }
      }
      await attempt(
        "runtime pool",
        () => runtime?.close() ?? Promise.resolve(),
      );
      await attempt("owner pool", () => owner?.close() ?? Promise.resolve());
      try {
        await removeContainer(deadline);
      } catch (error) {
        errors.push(error);
      }
      const pendingReplay = replay;
      if (pendingReplay)
        await attempt("migration drain", () =>
          pendingReplay.then(
            () => undefined,
            () => undefined,
          ),
        );
      const pendingAdvance = advancing;
      if (pendingAdvance)
        await attempt("advance drain", () =>
          pendingAdvance.then(
            () => undefined,
            () => undefined,
          ),
        );
      const directory = prefix;
      if (directory)
        await attempt(`prefix directory ${directory}`, () =>
          rm(directory, { recursive: true, force: true }),
        );
      if (errors.length)
        throw new AggregateError(
          errors,
          `PostgreSQL fixture cleanup failed: ${container}`,
        );
    })();
    return closing;
  }

  async function assertLedger(
    database: Database,
    index: number,
  ): Promise<void> {
    const { rows } = await database.sql.query<{ name: string; sha256: string }>(
      "select name, sha256 from __nightwatch_migrations order by name",
    );
    const expected = canonical
      .slice(0, index + 1)
      .map(({ name, sha256 }) => ({ name, sha256 }));
    if (JSON.stringify(rows) !== JSON.stringify(expected)) {
      throw new Error("Fixture ledger is not the exact canonical prefix");
    }
  }

  async function migrate(
    ready: { owner: Database; prefix: string; urls: TestDatabaseUrls },
    index: number,
    deadline: number,
  ): Promise<MigrationResult> {
    for (const migration of canonical.slice(copiedIndex + 1, index + 1)) {
      await copyFile(
        join(migrationsDir, migration.name),
        join(ready.prefix, migration.name),
      );
      copiedIndex++;
    }
    if (closing) throw new Error("PostgreSQL fixture is closing");
    const migrationUrl = new URL(ready.urls.ownerUrl);
    migrationUrl.searchParams.set("application_name", `fixture-${run}`);
    migrationUrl.searchParams.set("connect_timeout", "5");
    migrationUrl.searchParams.set(
      "options",
      "-c statement_timeout=15000 -c lock_timeout=10000",
    );
    replay = runMigrations({
      url: migrationUrl.toString(),
      migrationsDir: ready.prefix,
      log: () => undefined,
    });
    const result = await waitForResult(
      replay,
      Math.min(45_000, deadline - Date.now()),
      `migration ${container}`,
    );
    await assertLedger(ready.owner, index);
    currentIndex = index;
    return result;
  }

  try {
    await docker(
      [
        "create",
        "--rm",
        "--name",
        container,
        "--label",
        `${ownershipLabel}=${run}`,
        "--publish",
        "127.0.0.1::5432",
        "--env",
        "POSTGRES_USER=nightwatch_owner",
        "--env",
        "POSTGRES_DB=nightwatch",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "NW_DB_PASSWORD",
        "--volume",
        `${initRolesScript}:/docker-entrypoint-initdb.d/001-roles.sh:ro`,
        "postgres:17.11-alpine",
      ],
      Math.min(60_000, setupDeadline - Date.now()),
      {
        ...process.env,
        POSTGRES_PASSWORD: ownerPassword,
        NW_DB_PASSWORD: runtimePassword,
      },
    );
    await docker(
      ["start", container],
      Math.min(20_000, setupDeadline - Date.now()),
    );
    const readinessDeadline = Math.min(setupDeadline, Date.now() + 30_000);
    for (;;) {
      try {
        await docker(
          [
            "exec",
            container,
            "sh",
            "-ceu",
            "pg_isready -h 127.0.0.1 -U nightwatch_owner -d nightwatch >/dev/null && psql -h 127.0.0.1 -U nightwatch_owner -d nightwatch -Atqc \"select 1 from pg_roles where rolname = 'nightwatch'\" | grep -qx 1",
          ],
          Math.min(5_000, readinessDeadline - Date.now()),
        );
        break;
      } catch (error) {
        if (Date.now() >= readinessDeadline) throw error;
        await delay(100);
      }
    }
    const binding = (
      await docker(
        ["port", container, "5432/tcp"],
        Math.min(5_000, setupDeadline - Date.now()),
      )
    ).trim();
    const port = Number(/^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid PostgreSQL loopback port binding");
    const url = (username: string, password: string) => {
      const value = new URL(`postgres://127.0.0.1:${String(port)}/nightwatch`);
      value.username = username;
      value.password = password;
      return value.toString();
    };
    const urls = {
      ownerUrl: url("nightwatch_owner", ownerPassword),
      runtimeUrl: url("nightwatch", runtimePassword),
    };
    owner = createDatabase(urls.ownerUrl);
    await owner.sql.query("select 1");
    runtime = createDatabase(urls.runtimeUrl);
    await runtime.sql.query("select 1");
    prefix = await mkdtemp(join(tmpdir(), `nightwatch-postgres-${run}-`));
    const ready = { owner, prefix, urls };
    await migrate(ready, initialIndex, setupDeadline);
    return {
      owner,
      runtime,
      urls,
      close,
      async advanceTo(target) {
        if (closing) throw new Error("PostgreSQL fixture is closing");
        if (failed)
          throw new Error("PostgreSQL fixture replay failed; close required");
        if (advancing)
          throw new Error("PostgreSQL fixture is already advancing");
        const index = targetIndex(target);
        if (index < currentIndex)
          throw new Error("Cannot replay migrations backwards");
        advancing = (async () => {
          try {
            await assertLedger(ready.owner, currentIndex);
            return await migrate(ready, index, Date.now() + 45_000);
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            advancing = undefined;
          }
        })();
        return advancing;
      },
    };
  } catch (primary) {
    const cleanupErrors = await close().then(
      () => [],
      (error: unknown): unknown[] =>
        error instanceof AggregateError ? (error.errors as unknown[]) : [error],
    );
    if (cleanupErrors.length)
      throw new AggregateError(
        [primary, ...cleanupErrors],
        `PostgreSQL fixture setup and cleanup failed: ${container}`,
        { cause: primary },
      );
    throw primary;
  }
}
