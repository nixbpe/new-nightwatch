/**
 * AC-25, AC-42, AC-56: scan captured API and Worker logs and API response
 * bodies for the secret and query/body values the scenarios sent.
 *
 *   bun e2e/verification/scan-logs.ts <secrets.json>... @@ <log file>...
 *
 * Each secrets.json is `{ secrets: string[], hidden: string[] }` written by a
 * scenario script. Prefix patterns cover values a script generated but did not
 * save. Output is counts per file, never the matched text.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const split = args.indexOf("@@");
const secretFiles = args.slice(0, split);
const targets = args.slice(split + 1);

const values = new Set<string>();
for (const file of secretFiles) {
  const raw = JSON.parse(readFileSync(file, "utf8")) as
    string[] | { secrets: string[]; hidden: string[] };
  const parsed = Array.isArray(raw) ? { secrets: raw, hidden: [] } : raw;
  const scanned =
    process.env.SECRETS_ONLY === "1"
      ? parsed.secrets
      : [...parsed.secrets, ...parsed.hidden];
  for (const v of scanned) if (v.length >= 6) values.add(v);
}
const patterns = [
  /matrix-token-[0-9a-f]{8}/,
  /redirect-token-[0-9a-f]{8}/,
  /ui-token-[0-9a-f]{8}-/,
  /rls-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  /\bs-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/,
  ...(process.env.SECRETS_ONLY === "1"
    ? []
    : [/qval-[0-9a-f]{8}/, /bodyval-[0-9a-f]{8}/]),
];

let total = 0;
let bytes = 0;
for (const file of targets) {
  const text = readFileSync(file, "utf8");
  bytes += text.length;
  let hits = 0;
  for (const v of values) if (text.includes(v)) hits++;
  for (const p of patterns) if (p.test(text)) hits++;
  total += hits;
  console.log(
    `${hits === 0 ? "clean" : "HIT  "} ${String(text.length).padStart(9)} bytes  ${file}`,
  );
}
console.log(
  `needles: ${String(values.size)} exact values + ${String(patterns.length)} prefix patterns; files: ${String(targets.length)}; bytes: ${String(bytes)}; hits: ${String(total)}`,
);
process.exit(total === 0 ? 0 : 1);
