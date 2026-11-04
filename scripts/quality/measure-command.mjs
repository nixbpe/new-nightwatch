import { execFile, spawn } from "node:child_process";
import { mkdtemp, open, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const usage =
  "Usage: node scripts/quality/measure-command.mjs --output-dir <existing directory outside repo> -- <command> [args...]";
const args = process.argv.slice(2);
if (args[0] !== "--output-dir" || !args[1] || args[2] !== "--" || !args[3]) {
  console.error(usage);
  process.exit(2);
}
const execute = promisify(execFile);
/** @typedef {{command: string[], startedAt: string, durationMs: number, exitCode: number|null, signal: string|null, sampleCount: number, peakProcessTreeRssBytes: number|null, sampledCpuSeconds: number|null, measurementScope: string}} MeasurementRun */

async function main() {
  const output = await realpath(args[1]);
  const repo = await realpath(
    join(dirname(fileURLToPath(import.meta.url)), "../.."),
  );
  const path = relative(repo, output);
  if (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith("../"))
  ) {
    throw new Error("Output directory must be outside the repository.");
  }
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new Error("Measurement requires macOS or Linux ps.");
  }
  const directory = await mkdtemp(join(output, "measurement-"));
  const stdout = await open(join(directory, "stdout.log"), "wx", 0o600);
  const stderr = await open(join(directory, "stderr.log"), "wx", 0o600);
  /** @type {MeasurementRun} */
  const run = {
    command: args.slice(3),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: null,
    signal: null,
    sampleCount: 0,
    peakProcessTreeRssBytes: null,
    sampledCpuSeconds: null,
    measurementScope:
      "Host ps snapshots of the command PID and current PPID descendants, every 100 ms after the preceding sample completes. RSS is the largest snapshot sum in bytes, with shared pages counted per process. CPU is the sum of each observed PID's greatest cumulative CPU time, limited by ps clock precision. Short-lived, reparented, and between-sample activity can be missed; PID reuse can distort CPU totals. The wrapper, sampler, unrelated host processes, and Docker container memory/CPU are excluded. No command timeout; the caller controls cancellation.",
  };
  const started = performance.now();
  const child = spawn(run.command[0], run.command.slice(1), {
    detached: true,
    stdio: ["inherit", stdout.fd, stderr.fd],
  });
  const finished = new Promise((resolve) => {
    child.once("error", (error) => {
      run.exitCode = error.code === "ENOENT" ? 127 : 126;
      run.measurementScope += ` Command failed to start (${error.code}).`;
      resolve();
    });
    child.once("exit", (code, signal) => {
      run.exitCode = code;
      run.signal = signal;
      resolve();
    });
  }).then(() => {
    run.durationMs = performance.now() - started;
  });
  const forward = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, forward);
  const cpuByPid = new Map();
  try {
    while (run.exitCode === null && run.signal === null) {
      const { stdout: snapshot } = await execute(
        "ps",
        ["-axo", "pid=,ppid=,rss=,time="],
        {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const children = new Map();
      const rows = new Map();
      for (const line of snapshot.trim().split("\n")) {
        const [pid, ppid, rss, time] = line.trim().split(/\s+/);
        const [clock, days = "0"] = time.split("-").reverse();
        const cpu =
          Number(days) * 86400 +
          clock.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
        rows.set(Number(pid), { rss: Number(rss) * 1024, cpu });
        if (!children.has(Number(ppid))) children.set(Number(ppid), []);
        children.get(Number(ppid)).push(Number(pid));
      }
      const tree = [child.pid];
      let rss = 0;
      for (let index = 0; index < tree.length; index++) {
        const pid = tree[index];
        const row = rows.get(pid);
        if (!row) continue;
        rss += row.rss;
        cpuByPid.set(pid, Math.max(cpuByPid.get(pid) ?? 0, row.cpu));
        tree.push(...(children.get(pid) ?? []));
      }
      if (rows.has(child.pid)) {
        run.sampleCount++;
        run.peakProcessTreeRssBytes = Math.max(
          run.peakProcessTreeRssBytes ?? 0,
          rss,
        );
        run.sampledCpuSeconds = [...cpuByPid.values()].reduce(
          (sum, cpu) => sum + cpu,
          0,
        );
      }
      await Promise.race([finished, delay(100)]);
    }
  } catch {
    run.peakProcessTreeRssBytes = null;
    run.sampledCpuSeconds = null;
    run.measurementScope +=
      " Sampling failed; resource metrics are unavailable.";
  }
  await finished;
  await Promise.all([stdout.close(), stderr.close()]);
  await writeFile(
    join(directory, "measurement.json"),
    JSON.stringify(run, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(directory);
  for (const signal of signals) process.off(signal, forward);
  process.exitCode = run.signal
    ? 128 + constants.signals[run.signal]
    : run.exitCode;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
