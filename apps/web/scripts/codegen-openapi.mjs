#!/usr/bin/env bun
/**
 * Regenerate src/lib/api/openapi-types.gen.ts from the API's OpenAPI
 * document. Run via `bun run codegen` in apps/web.
 *
 * The spec is obtained from apps/api's `emit-openapi` script, which
 * composes the real Hono app in-process — no server, database, or SMTP
 * needed — and writes GET /api/v1/openapi.json to a temp file.
 * openapi-typescript then renders the compile-time types. Deterministic:
 * two runs against an unchanged API produce a byte-identical file.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const apiDir = join(webRoot, "..", "api");
const outFile = join(webRoot, "src", "lib", "api", "openapi-types.gen.ts");

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Produced by \`bun run codegen\` (apps/web/scripts/codegen-openapi.mjs) from
 * the apps/api OpenAPI document (GET /api/v1/openapi.json, emitted in-process
 * by apps/api's \`bun run emit-openapi\`). Regenerate after contract changes.
 */

`;

const specDir = mkdtempSync(join(tmpdir(), "nightwatch-openapi-"));
try {
  const specFile = join(specDir, "openapi.json");
  execFileSync("bun", ["run", "emit-openapi", specFile], {
    cwd: apiDir,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const spec = JSON.parse(readFileSync(specFile, "utf8"));
  const ast = await openapiTS(spec);
  writeFileSync(outFile, HEADER + astToString(ast));
} finally {
  rmSync(specDir, { recursive: true, force: true });
}
