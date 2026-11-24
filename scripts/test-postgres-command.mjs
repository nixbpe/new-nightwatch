import { spawn } from "node:child_process";
import {
  buildLocalComposeUrls,
  LOCAL_ENV_PATH,
  resolveDevEnv,
} from "./dev-env.mjs";
import { readEnvFile } from "./env-file.mjs";
import { repoRoot } from "./ports.mjs";

export function testPostgresCommand(ownerUrl) {
  const container = process.env.TEST_POSTGRES_CONTAINER;
  let prefix;
  if (container) {
    if (!/^[0-9a-f]{64}$/.test(container))
      throw new Error("Invalid CI PostgreSQL container ID");
    prefix = ["exec", "-i", container];
  } else {
    const { ports, hasLocalEnv } = resolveDevEnv();
    const local = readEnvFile(LOCAL_ENV_PATH);
    if (
      !hasLocalEnv ||
      buildLocalComposeUrls(local, ports).ownerUrl !== ownerUrl
    )
      throw new Error("Expected owning worktree database");
    prefix = [
      "compose",
      "-f",
      `${repoRoot}/compose.yaml`,
      "-p",
      `nw-dev-${ports.slot}`,
      "exec",
      "-T",
      "postgres",
    ];
  }
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn("docker", [...prefix, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      // Do not expose dump/schema or credentials in a failed command's output.
      child.stderr.resume();
      child.stdin.on("error", reject);
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(output)
          : reject(new Error(`PostgreSQL test command exited with ${code}`)),
      );
      child.stdin.end(input);
    });
}
