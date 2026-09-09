import { readFileSync } from "node:fs";

/**
 * Minimal KEY=VALUE environment file reader shared by scripts that must read
 * the gitignored `.env.compose.local` without mutating process.env.
 * Supports `#` comments and single/double-quoted values; no multiline values.
 */

export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key === "") continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

export function readEnvFile(path) {
  return parseEnvFile(readFileSync(path, "utf8"));
}
