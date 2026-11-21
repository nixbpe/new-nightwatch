import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname);
// Static `import … from`, `export … from`, bare `import "…"` and dynamic `import("…")`.
const SPECIFIER =
  /(?:^|[\s;])(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']|(?:^|[\s;])import\s*\(?\s*["']([^"']+)["']/g;

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  return (
    [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")].find(
      (candidate) => candidate.endsWith(".ts") && existsSync(candidate),
    ) ?? null
  );
}

/** Every file under src/ the entry reaches through relative imports. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const next = resolveLocal(file, match[1] ?? match[2] ?? "");
      if (next !== null) queue.push(next);
    }
  }
  return [...seen].map((file) => relative(SRC, file));
}

// TS-003: the fake STS client lives only in the test-only entry; the
// production entry and bootstrap must not be able to reach it.
describe("production API entry isolation", () => {
  it.each(["index.ts", "server.ts"])(
    "%s reaches no file under src/testing/",
    (entry) => {
      const files = reachable(entry);
      expect(files).toContain("app.ts");
      expect(files.filter((file) => file.startsWith("testing/"))).toEqual([]);
    },
  );

  it("the walker does see the e2e entry's own testing import", () => {
    expect(reachable("testing/e2e-server.ts")).toContain("server.ts");
  });
});
