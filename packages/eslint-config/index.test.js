import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

import { createConfig } from "./index.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function lintImport(
  kind,
  specifier,
  filePath = "packages/eslint-config/src/boundary.js",
) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: createConfig({ kind }),
  });
  const [result] = await eslint.lintText(`import "${specifier}";`, {
    filePath,
  });

  return result.messages;
}

const forbiddenImports = [
  ["web", "@nightwatch/db", "web allows only @nightwatch/api-contract."],
  ["web", "@nightwatch/queue", "web allows only @nightwatch/api-contract."],
  ["web", "pg", "web forbids PostgreSQL and Redis clients."],
  ["web", "redis", "web forbids PostgreSQL and Redis clients."],
  [
    "web",
    "@nightwatch/api-contract/auth",
    "@nightwatch/api-contract exports are available only from its package root.",
  ],
  [
    "shared",
    "@nightwatch/api-contract",
    "shared allows no workspace runtime packages.",
  ],
  ["db", "@nightwatch/shared", "db allows no workspace runtime packages."],
  [
    "api-contract",
    "@nightwatch/db",
    "api-contract allows no workspace runtime packages.",
  ],
  [
    "api",
    "@nightwatch/web",
    "api allows only @nightwatch/api-contract, @nightwatch/shared, @nightwatch/db.",
  ],
  [
    "config",
    "@nightwatch/shared",
    "config allows no workspace runtime packages.",
  ],
];

for (const [kind, specifier, policyMessage] of forbiddenImports) {
  test(`${kind} rejects ${specifier}`, async () => {
    const messages = (await lintImport(kind, specifier)).map(
      ({ ruleId, severity, message }) => ({ ruleId, severity, message }),
    );

    assert.deepEqual(messages, [
      {
        ruleId: "no-restricted-imports",
        severity: 2,
        message: `'${specifier}' import is restricted from being used by a pattern. ${policyMessage}`,
      },
    ]);
  });
}

const forbiddenRelativeImports = [
  ["web", "../../../packages/db/src/client", "apps/web/src/boundary.js"],
  [
    "api",
    "../../../packages/api-contract/src/auth",
    "apps/api/src/boundary.js",
  ],
  [
    "web",
    "../../../packages/api-contract/src/auth",
    "apps/web/src/boundary.js",
  ],
  ["shared", "../../../apps/api/src/app", "packages/shared/src/boundary.js"],
  ["shared", "../../db/src/client", "packages/shared/src/boundary.js"],
  ["api", "../../web/src/main", "apps/api/src/boundary.js"],
];

for (const [kind, specifier, filePath] of forbiddenRelativeImports) {
  test(`${kind} rejects cross-workspace ${specifier}`, async () => {
    const messages = (await lintImport(kind, specifier, filePath)).map(
      ({ ruleId, severity, message }) => ({ ruleId, severity, message }),
    );
    assert.deepEqual(messages, [
      {
        ruleId: "nightwatch/no-cross-workspace-relative-imports",
        severity: 2,
        message:
          "Relative imports must not cross workspace roots; import through the package root.",
      },
    ]);
  });
}

test("web allows an internal directory named api", async () => {
  assert.deepEqual(
    await lintImport("web", "../api/me", "apps/web/src/lib/boundary.js"),
    [],
  );
});

test("workspace kind is required", () => {
  assert.throws(
    () => createConfig(),
    /createConfig requires a valid workspace kind/,
  );
});

const allowedImports = [
  ["web", "@nightwatch/api-contract"],
  ["api", "@nightwatch/api-contract"],
  ["api", "@nightwatch/shared"],
  ["api", "@nightwatch/db/subpath"],
  ["shared", "zod"],
  ["db", "pg"],
  ["api-contract", "zod"],
  ["config", "eslint"],
];

for (const [kind, specifier] of allowedImports) {
  test(`${kind} allows ${specifier}`, async () => {
    assert.deepEqual(await lintImport(kind, specifier), []);
  });
}
