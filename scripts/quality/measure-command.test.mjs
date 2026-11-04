import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function outputDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "nw-measure-test-"));
  roots.push(directory);
  return directory;
}

function invoke(args, env = process.env) {
  const child = spawn(
    "node",
    [resolve("scripts/quality/measure-command.mjs"), ...args],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
}

async function measured(directory, command, env) {
  const result = await invoke(
    ["--output-dir", directory, "--", ...command],
    env,
  );
  const artifact = result.stdout.trim();
  return {
    ...result,
    artifact,
    run: JSON.parse(await readFile(join(artifact, "measurement.json"), "utf8")),
    out: await readFile(join(artifact, "stdout.log"), "utf8"),
    err: await readFile(join(artifact, "stderr.log"), "utf8"),
  };
}

for (const args of [
  [],
  ["--output-dir", "/tmp"],
  ["--output-dir", "/tmp", "--"],
  ["--unknown", "/tmp", "--", "true"],
]) {
  test(`rejects incomplete or unknown arguments ${JSON.stringify(args)}`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Usage: node scripts/quality/measure-command.mjs --output-dir <existing directory outside repo> -- <command> [args...]\n",
    );
  });
}

test("rejects repository output, including a symlink alias", async () => {
  const root = await outputDirectory();
  await symlink(await realpath("."), join(root, "repo"));
  for (const directory of [resolve("."), join(root, "repo")]) {
    const result = await invoke([
      "--output-dir",
      directory,
      "--",
      "node",
      "-e",
      "process.exit(99)",
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Output directory must be outside the repository.\n",
    );
  }
});

test("preserves failure, exact arguments and separate logs, with fresh artifacts on rerun", async () => {
  const directory = await outputDirectory();
  const command = [
    "node",
    "-e",
    "console.log(process.argv[1]); console.error('problem'); process.exit(7)",
    "two words",
  ];
  const first = await measured(directory, command);
  const second = await measured(directory, command);
  expect(first.code).toBe(7);
  expect(first.run.command).toEqual(command);
  expect(first.run.exitCode).toBe(7);
  expect(first.run.signal).toBe(null);
  expect(first.out).toBe("two words\n");
  expect(first.err).toBe("problem\n");
  expect(second.code).toBe(7);
  expect(second.artifact === first.artifact).toBe(false);
  expect(await readFile(join(first.artifact, "stdout.log"), "utf8")).toBe(
    "two words\n",
  );
  expect(
    Number.isFinite(first.run.durationMs) && first.run.durationMs >= 0,
  ).toBe(true);
  expect(Number.isNaN(Date.parse(first.run.startedAt))).toBe(false);
});

test.each([
  ["SIGTERM", 143],
  ["SIGPIPE", 141],
  ["SIGUSR1", process.platform === "darwin" ? 158 : 138],
])(
  "records %s and returns shell-compatible status %i",
  async (signal, code) => {
    const result = await measured(await outputDirectory(), [
      "/bin/sh",
      "-c",
      `kill -${signal.slice(3)} $$`,
    ]);
    expect(result.code).toBe(code);
    expect(result.signal).toBe(null);
    expect(result.run.exitCode).toBe(null);
    expect(result.run.signal).toBe(signal);
    expect(result.stderr).toBe("");
  },
);

test("forwards wrapper SIGTERM to its command process group", async () => {
  const result = await measured(await outputDirectory(), [
    "node",
    "-e",
    "setTimeout(() => process.kill(process.ppid, 'SIGTERM'), 100); setInterval(() => {}, 1000)",
  ]);
  expect(result.code).toBe(143);
  expect(result.signal).toBe(null);
  expect(result.run.signal).toBe("SIGTERM");
  expect(result.run.exitCode).toBe(null);
});

test("reports a command that cannot start", async () => {
  const result = await measured(await outputDirectory(), [
    "/nonexistent/nightwatch-measure-command",
  ]);
  expect(result.code).toBe(127);
  expect(result.run.exitCode).toBe(127);
  expect(result.run.signal).toBe(null);
  expect(result.run.sampleCount).toBe(0);
  expect(result.run.peakProcessTreeRssBytes).toBe(null);
});

test("sums one process-tree snapshot and excludes unrelated rows", async () => {
  const directory = await outputDirectory();
  const pidFile = join(directory, "pid");
  await writeFile(
    join(directory, "ps"),
    `#!${process.execPath}
import { existsSync, readFileSync } from "node:fs";
const file = ${JSON.stringify(pidFile)};
if (!existsSync(file)) console.log("1 0 1 00:00:00");
else {
  const pid = Number(readFileSync(file, "utf8"));
  console.log([
    [pid, 1, 10, "00:00:01"],
    [pid + 10, pid, 20, "00:00:02"],
    [pid + 20, pid + 10, 30, "00:00:03"],
    [pid + 30, 1, 4000, "00:00:99"],
  ].map(row => row.join(" ")).join("\\n"));
}
`,
    { mode: 0o755 },
  );
  const result = await measured(
    directory,
    [
      "node",
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
     setTimeout(() => console.log('done'), 700);`,
    ],
    { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  );
  expect(result.code).toBe(0);
  expect(result.out).toBe("done\n");
  expect(result.run.sampleCount >= 2).toBe(true);
  expect(result.run.peakProcessTreeRssBytes).toBe(61440);
  expect(result.run.sampledCpuSeconds).toBe(6);
});

test("samples a live parent and its CPU-bound child", async () => {
  const worker = `
    const memory = Buffer.alloc(4096, 1);
    let cpu;
    do { cpu = process.cpuUsage(); } while (cpu.user + cpu.system < 1100000);
    setTimeout(() => console.log(memory[0]), 700);
  `;
  const command = `
    const { spawn } = require('node:child_process');
    const memory = Buffer.alloc(4096, 1);
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], { stdio: 'inherit' });
    child.on('exit', (code) => { console.log(memory[0]); process.exitCode = code; });
  `;

  const result = await measured(await outputDirectory(), [
    "node",
    "-e",
    command,
  ]);
  expect(result.code).toBe(0);
  expect(result.out).toBe("1\n1\n");
  expect(result.run.sampleCount >= 3).toBe(true);
  expect(result.run.peakProcessTreeRssBytes >= 16 * 1024 * 1024).toBe(true);
  expect(result.run.sampledCpuSeconds >= 1).toBe(true);
  expect(result.run.measurementScope.includes("Sampling failed")).toBe(false);
}, 10000);
