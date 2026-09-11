import path from "node:path";
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const workspaceImportAllowlists = {
  web: ["@nightwatch/api-contract"],
  api: ["@nightwatch/api-contract", "@nightwatch/shared", "@nightwatch/db"],
  shared: [],
  db: [],
  "api-contract": [],
  config: [],
};

function workspaceLocation(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  const markerIndex = parts.findIndex(
    (part, index) =>
      (part === "apps" || part === "packages") &&
      parts[index + 1] !== undefined,
  );
  if (markerIndex < 0) {
    return null;
  }
  return parts.slice(0, markerIndex + 2).join(path.sep);
}

const workspaceBoundaryPlugin = {
  rules: {
    "no-cross-workspace-relative-imports": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          crossing:
            "Relative imports must not cross workspace roots; import through the package root.",
        },
      },
      create(context) {
        const importerRoot = workspaceLocation(context.filename);
        const checkSource = (node) => {
          const specifier = node.source?.value;
          if (
            importerRoot === null ||
            typeof specifier !== "string" ||
            !specifier.startsWith(".")
          ) {
            return;
          }
          const targetRoot = workspaceLocation(
            path.resolve(path.dirname(context.filename), specifier),
          );
          if (targetRoot !== null && targetRoot !== importerRoot) {
            context.report({ node: node.source, messageId: "crossing" });
          }
        };
        return {
          ImportDeclaration: checkSource,
          ExportAllDeclaration: checkSource,
          ExportNamedDeclaration: checkSource,
          ImportExpression(node) {
            if (node.source.type === "Literal") {
              checkSource({ source: node.source });
            }
          },
        };
      },
    },
  },
};

function workspaceBoundaryPattern(kind) {
  if (!Object.hasOwn(workspaceImportAllowlists, kind)) {
    throw new TypeError(
      `createConfig requires a valid workspace kind (${Object.keys(workspaceImportAllowlists).join(", ")}).`,
    );
  }

  const allowed = workspaceImportAllowlists[kind];
  const allowance =
    allowed.length === 0
      ? "no workspace runtime packages"
      : `only ${allowed.join(", ")}`;
  const allowedPackageNames = allowed
    .map((specifier) => specifier.slice("@nightwatch/".length))
    .join("|");

  return {
    regex:
      allowed.length === 0
        ? "^@nightwatch/"
        : `^@nightwatch/(?!(?:${allowedPackageNames})(?:/|$)).+`,
    message: `${kind} allows ${allowance}.`,
  };
}

const apiContractRootOnlyPattern = {
  regex: "^@nightwatch/api-contract/",
  message:
    "@nightwatch/api-contract exports are available only from its package root.",
};

/**
 * NightWatch flat-config factory.
 *
 * Every workspace declares its PKG-01 importer kind. The kind selects a
 * centralized workspace-import allowlist, while `react` and `apiService`
 * retain their framework-specific rules.
 */
export function createConfig({ kind, react = false, apiService = false } = {}) {
  const boundaryPattern = workspaceBoundaryPattern(kind);
  const boundaryPatterns = [boundaryPattern, apiContractRootOnlyPattern];
  if (kind === "web") {
    boundaryPatterns.push({
      regex:
        "^(?:pg|postgres|drizzle-orm|redis|ioredis|bullmq|@redis/|@upstash/redis)(?:/|$)",
      message: "web forbids PostgreSQL and Redis clients.",
    });
  }

  return tseslint.config(
    {
      name: "nightwatch/ignores",
      ignores: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/.turbo/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      name: "nightwatch/typescript",
      languageOptions: {
        parserOptions: {
          // Type-aware linting resolves each file through its nearest tsconfig.
          projectService: true,
        },
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/consistent-type-imports": "error",
      },
    },
    {
      // Plain JS files (e.g. eslint.config.js) usually sit outside any
      // tsconfig project; lint them with untyped core rules only.
      name: "nightwatch/javascript",
      files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
      ...tseslint.configs.disableTypeChecked,
      languageOptions: {
        parserOptions: {
          projectService: false,
        },
      },
    },
    ...(react
      ? [
          {
            name: "nightwatch/react",
            plugins: { "react-hooks": reactHooks },
            rules: {
              "react-hooks/rules-of-hooks": "error",
              "react-hooks/exhaustive-deps": "warn",
            },
          },
        ]
      : []),
    {
      name: "nightwatch/workspace-boundary",
      files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
      ignores: ["eslint.config.js"],
      plugins: { nightwatch: workspaceBoundaryPlugin },
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: boundaryPatterns,
          },
        ],
        "nightwatch/no-cross-workspace-relative-imports": "error",
      },
    },
    ...(apiService
      ? [
          {
            name: "nightwatch/api-service-boundary",
            files: ["src/**/*.service.ts"],
            rules: {
              "no-restricted-imports": [
                "error",
                {
                  patterns: [
                    ...boundaryPatterns,
                    {
                      group: ["hono", "hono/*", "@hono/*"],
                      message:
                        "Service files hold business logic and must not depend on Hono. HTTP concerns belong in routes.",
                    },
                  ],
                },
              ],
            },
          },
        ]
      : []),
  );
}
