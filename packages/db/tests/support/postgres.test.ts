import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  copyFile: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  createDatabase: vi.fn(),
  runMigrations: vi.fn(),
  listMigrations: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  copyFile: mocks.copyFile,
  mkdtemp: mocks.mkdtemp,
  rm: mocks.rm,
}));
vi.mock("../../src/client", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("../../src/migrator", () => ({
  runMigrations: mocks.runMigrations,
  listMigrations: mocks.listMigrations,
}));

import { openTestPostgres } from "./postgres";

const canonical = [
  { name: "0001_first.sql", sha256: "first", sql: "select 1" },
  { name: "0002_second.sql", sha256: "second", sql: "select 2" },
];
let present: boolean;
let identity: string;
let ledger: { name: string; sha256: string }[];
let fault: string | undefined;
let cleanupFault: boolean;
let commands: string[][];
let pools: ReturnType<typeof pool>[];

function pool() {
  return {
    sql: { query: vi.fn(() => Promise.resolve({ rows: ledger })) },
    close: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  present = false;
  fault = undefined;
  cleanupFault = false;
  ledger = [];
  commands = [];
  pools = [];
  mocks.listMigrations.mockResolvedValue(canonical);
  mocks.mkdtemp.mockResolvedValue("/tmp/fixture-unit-prefix");
  mocks.copyFile.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.createDatabase.mockImplementation(() => {
    const opened = pool();
    pools.push(opened);
    return opened;
  });
  mocks.runMigrations.mockImplementation(() => {
    const before = ledger.length;
    const count = mocks.copyFile.mock.calls.length;
    ledger = canonical
      .slice(0, count)
      .map(({ name, sha256 }) => ({ name, sha256 }));
    return Promise.resolve({
      applied: canonical.slice(before, count).map(({ name }) => name),
      alreadyApplied: canonical.slice(0, before).map(({ name }) => name),
    });
  });
  mocks.spawn.mockImplementation((_command: string, args: string[]) => {
    commands.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit("close", null));
        return true;
      }),
    });
    queueMicrotask(() => {
      const operation = args[0];
      let output = "";
      if (operation === "create") {
        present = true;
        identity =
          String(args[args.indexOf("--label") + 1])
            .split("=")
            .at(1) ?? "";
      }
      if (operation === "container") output = present ? "owned-id\n" : "";
      if (operation === "inspect") output = `${identity}\n`;
      if (operation === "port") output = "127.0.0.1:54321\n";
      if (operation === "rm" && !cleanupFault) present = false;
      if (fault === operation || (operation === "rm" && cleanupFault)) {
        child.stderr.write("secret must not escape");
        child.emit("close", 1);
      } else {
        child.stdout.write(output);
        child.emit("close", 0);
      }
    });
    return child;
  });
});
afterEach(() => vi.useRealTimers());

describe("openTestPostgres", () => {
  it("rejects a nonexistent target and unsafe label before acquiring Docker", async () => {
    await expect(openTestPostgres("unit", "0999_missing.sql")).rejects.toThrow(
      "Unknown canonical migration",
    );
    await expect(openTestPostgres("../../unsafe")).rejects.toThrow("label");
    expect(commands).toEqual([]);
  });

  it.each(["create", "start", "port"])(
    "reconciles exact ownership after %s fails without leaking command output",
    async (operation) => {
      fault = operation;
      await expect(openTestPostgres("unit")).rejects.toMatchObject({
        message: `docker ${operation} failed`,
      });
      expect(present).toBe(false);
      expect(commands.find((args) => args[0] === "rm")?.slice(1, 3)).toEqual([
        "--force",
        "--volumes",
      ]);
    },
  );

  it("bounds failed readiness and removes its cluster", async () => {
    vi.useFakeTimers();
    fault = "exec";
    const assertion = expect(openTestPostgres("unit")).rejects.toThrow(
      "docker exec failed",
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(present).toBe(false);
  });

  it("removes the prefix and container after a copy failure", async () => {
    const primary = new Error("copy failed");
    mocks.copyFile.mockRejectedValueOnce(primary);
    await expect(openTestPostgres("unit")).rejects.toBe(primary);
    expect(present).toBe(false);
    expect(mocks.rm.mock.calls[0]).toEqual([
      "/tmp/fixture-unit-prefix",
      { recursive: true, force: true },
    ]);
  });

  it.each([0, 1])(
    "registers pool %s before its failed health query and cleans acquired pools",
    async (failedPool) => {
      const primary = new Error("pool health failed");
      mocks.createDatabase.mockImplementation(() => {
        const opened = pool();
        if (pools.length === failedPool)
          opened.sql.query.mockRejectedValueOnce(primary);
        pools.push(opened);
        return opened;
      });
      await expect(openTestPostgres("unit")).rejects.toBe(primary);
      expect(pools.map((opened) => opened.close.mock.calls.length)).toEqual(
        Array.from({ length: failedPool + 1 }, () => 1),
      );
      expect(present).toBe(false);
    },
  );

  it("keeps a migration failure as the primary error and still removes all resources", async () => {
    const primary = new Error("migration failed");
    mocks.runMigrations.mockRejectedValueOnce(primary);
    await expect(openTestPostgres("unit")).rejects.toBe(primary);
    expect(present).toBe(false);
    expect(mocks.rm.mock.calls).toHaveLength(1);
  });

  it("preserves primary plus cleanup failure and never claims unverified removal", async () => {
    fault = "start";
    cleanupFault = true;
    const outcome = await openTestPostgres("unit").catch(
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    const errors = (outcome as AggregateError).errors as Error[];
    expect(errors[0]?.message).toContain("docker start failed");
    expect(errors[1]?.message).toContain("container");
    expect(present).toBe(true);
  });

  it("attempts later cleanup after pool and directory failures and memoizes rejected close", async () => {
    const fixture = await openTestPostgres("unit");
    pools.at(1)?.close.mockRejectedValueOnce(new Error("runtime close failed"));
    mocks.rm.mockRejectedValueOnce(new Error("directory close failed"));
    const closing = fixture.close();
    expect(fixture.close()).toBe(closing);
    await expect(closing).rejects.toMatchObject({
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(pools.at(0)?.close.mock.calls).toHaveLength(1);
    expect(present).toBe(false);
    await expect(fixture.advanceTo("latest")).rejects.toThrow("closing");
  });

  it("copies accumulated canonical prefixes and rejects backwards or altered history", async () => {
    const fixture = await openTestPostgres("unit", "0001_first.sql");
    expect(ledger).toEqual([{ name: "0001_first.sql", sha256: "first" }]);
    expect(await fixture.advanceTo("latest")).toEqual({
      applied: ["0002_second.sql"],
      alreadyApplied: ["0001_first.sql"],
    });
    expect(await fixture.advanceTo("latest")).toEqual({
      applied: [],
      alreadyApplied: ["0001_first.sql", "0002_second.sql"],
    });
    await expect(fixture.advanceTo("0001_first.sql")).rejects.toThrow(
      "backwards",
    );
    ledger.pop();
    await expect(fixture.advanceTo("latest")).rejects.toThrow(
      "canonical prefix",
    );
    await expect(fixture.advanceTo("latest")).rejects.toThrow("failed");
    await fixture.close();
  });

  it("attempts both pools and Docker after temporary directory acquisition fails", async () => {
    const primary = new Error("mkdtemp failed");
    mocks.mkdtemp.mockRejectedValueOnce(primary);
    await expect(openTestPostgres("unit")).rejects.toBe(primary);
    expect(pools.map((opened) => opened.close.mock.calls.length)).toEqual([
      1, 1,
    ]);
    expect(present).toBe(false);
  });

  it("rejects overlapping stages and drains an interrupted advance before deleting its directory", async () => {
    const fixture = await openTestPostgres("unit", "0001_first.sql");
    const copying = Promise.withResolvers<undefined>();
    mocks.copyFile.mockReturnValueOnce(copying.promise);
    const advancing = fixture.advanceTo("latest");
    const assertion = expect(advancing).rejects.toThrow("closing");
    await expect(fixture.advanceTo("latest")).rejects.toThrow(
      "already advancing",
    );
    const closing = fixture.close();
    copying.resolve(undefined);
    await assertion;
    await closing;
    expect(ledger).toEqual([{ name: "0001_first.sql", sha256: "first" }]);
    expect(present).toBe(false);
    expect(mocks.rm.mock.calls).toHaveLength(1);
  });

  it("reports a timed-out migrator as undrained even after attempting Docker removal", async () => {
    const fixture = await openTestPostgres("unit", "0001_first.sql");
    vi.useFakeTimers();
    const running = Promise.withResolvers<never>();
    mocks.runMigrations.mockReturnValueOnce(running.promise);
    const assertion = expect(fixture.advanceTo("latest")).rejects.toThrow(
      "operation not drained",
    );
    await vi.advanceTimersByTimeAsync(46_000);
    await assertion;
    const closing = expect(fixture.close()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          message: "Cleanup failed for migration drain",
        }),
      ],
    });
    await vi.advanceTimersByTimeAsync(6_000);
    await closing;
    expect(present).toBe(false);
    running.reject(new Error("transport ended"));
  });

  it("refuses removal on ownership mismatch and reports daemon uncertainty", async () => {
    const fixture = await openTestPostgres("unit");
    identity = "another-run";
    await expect(fixture.close()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          message: expect.stringContaining(
            "Unresolved owned container",
          ) as unknown,
        }),
      ],
    });
    expect(present).toBe(true);
    expect(commands.filter((args) => args[0] === "rm")).toEqual([]);

    const second = await openTestPostgres("second");
    fault = "container";
    await expect(second.close()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          message: expect.stringContaining(
            "Unresolved owned container",
          ) as unknown,
        }),
      ],
    });
    expect(present).toBe(true);
  });

  it("kills and observes a timed out child before ownership reconciliation", async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit("close", null));
        return true;
      }),
    });
    mocks.spawn.mockImplementationOnce(() => child);
    const opening = openTestPostgres("unit");
    const assertion = expect(opening).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(90_000);
    await assertion;
    expect(child.kill.mock.calls[0]).toEqual(["SIGTERM"]);
    expect(present).toBe(false);
  });
});
