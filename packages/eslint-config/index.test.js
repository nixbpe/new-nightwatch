import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

import { createConfig } from "./index.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function lint(kind, code, filePath = "src/boundary.js") {
  const workspace = ["web", "api", "worker"].includes(kind)
    ? `apps/${kind}`
    : `packages/${kind === "config" ? "eslint-config" : kind}`;
  const eslint = new ESLint({
    cwd: `${repoRoot}/${workspace}`,
    overrideConfigFile: true,
    overrideConfig: [
      ...createConfig({ kind, apiService: ["api", "worker"].includes(kind) }),
      // Virtual snippets exercise import policies, not TypeScript project discovery.
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map(({ ruleId, severity }) => ({ ruleId, severity }));
}

const error = (ruleId) => [{ ruleId, severity: 2 }];
const policy = {
  web: [
    ["@nightwatch/api-contract", true],
    ["@nightwatch/db", false],
    ["@nightwatch/queue", false],
    ["pg", false],
    ["redis", false],
    ["@redis/client", false],
    ["@redis/client/dist", false],
    ["@upstash/redis", false],
    ["@redis-tools/client", true],
    ["@nightwatch/api-contract/auth", false],
    ["@nightwatch/api-contract-extra", false],
    ["pg-formatter", true],
  ],
  api: [
    ["@nightwatch/api-contract", true],
    ["@nightwatch/shared", true],
    ["@nightwatch/db", true],
    ["@nightwatch/db/subpath", true],
    ["@nightwatch/web", false],
  ],
  worker: [
    ["@nightwatch/shared", true],
    ["@nightwatch/db", true],
    ["@nightwatch/api-contract", false],
    ["@nightwatch/api", false],
  ],
  shared: [
    ["zod", true],
    ["@nightwatch/api-contract", false],
  ],
  db: [
    ["pg", true],
    ["@nightwatch/shared", false],
  ],
  "api-contract": [
    ["zod", true],
    ["@nightwatch/db", false],
  ],
  config: [
    ["eslint", true],
    ["@nightwatch/shared", false],
  ],
};
for (const [kind, cases] of Object.entries(policy)) {
  test(`${kind} workspace import policy`, async () => {
    for (const [specifier, allowed] of cases) {
      assert.deepEqual(
        await lint(kind, `import "${specifier}";`),
        allowed ? [] : error("no-restricted-imports"),
        `${kind}: ${specifier}`,
      );
    }
  });
}

const syntax = {
  import: (s) => `import "${s}";`,
  "export all": (s) => `export * from "${s}";`,
  "export named": (s) => `export { value } from "${s}";`,
  "dynamic import": (s) => `await import("${s}");`,
  "static template import": (s) => `await import(\`${s}\`);`,
};
for (const [name, code] of Object.entries(syntax)) {
  test(`${name} respects relative workspace boundaries`, async () => {
    assert.deepEqual(
      await lint(
        "web",
        code("../../../../packages/db/src/client"),
        "src/lib/boundary.js",
      ),
      error("nightwatch/no-cross-workspace-relative-imports"),
    );
    assert.deepEqual(
      await lint("web", code("../api/me"), "src/lib/boundary.js"),
      [],
    );
  });
}

test("relative boundaries cover both workspace roots and allowed named packages", async () => {
  for (const [kind, source] of [
    ["api", "../../web/src/main"],
    ["shared", "../../../apps/api/src/app"],
    ["shared", "../../db/src/client"],
    ["api", "../../../packages/api-contract/src/auth"],
  ]) {
    assert.deepEqual(
      await lint(kind, syntax.import(source)),
      error("nightwatch/no-cross-workspace-relative-imports"),
      `${kind}: ${source}`,
    );
  }
});

for (const name of ["dynamic import", "static template import"]) {
  test(`${name} obeys named import policies`, async () => {
    for (const [specifier, allowed] of policy.web) {
      assert.deepEqual(
        await lint("web", syntax[name](specifier)),
        allowed ? [] : error("no-restricted-syntax"),
        specifier,
      );
    }
  });
}

test("service profile blocks Hono for actual service filenames", async () => {
  for (const file of ["service.ts", "read-service.ts", "projects.service.ts"]) {
    for (const specifier of [
      "hono",
      "hono/http-exception",
      "@hono/zod-openapi",
    ]) {
      assert.deepEqual(
        await lint("api", syntax.import(specifier), `src/projects/${file}`),
        error("no-restricted-imports"),
        `${file}: ${specifier}`,
      );
      assert.deepEqual(
        await lint(
          "api",
          syntax["dynamic import"](specifier),
          `src/projects/${file}`,
        ),
        error("no-restricted-syntax"),
      );
    }
    assert.deepEqual(
      await lint(
        "api",
        syntax.import("@nightwatch/db"),
        `src/projects/${file}`,
      ),
      [],
    );
  }
  assert.deepEqual(
    await lint("api", syntax.import("hono"), "src/projects/routes.ts"),
    [],
  );
});

test("workspace kind is required and must be known", () => {
  for (const options of [undefined, { kind: "typo" }]) {
    assert.throws(
      () => createConfig(options),
      /createConfig requires a valid workspace kind/,
    );
  }
});
