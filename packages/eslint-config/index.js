import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * NightWatch flat-config factory.
 *
 * Usage in a workspace `eslint.config.js`:
 *   import { createConfig } from '@nightwatch/eslint-config';
 *   export default createConfig({ react: true });      // apps/web
 *   export default createConfig({ apiService: true }); // apps/api
 *   export default createConfig();                     // packages/*
 *
 * Composes: eslint recommended + typescript-eslint strict-type-checked
 * (type-aware via the TS project service) + the contracted rules
 * (no-explicit-any, no-floating-promises, consistent-type-imports).
 *
 * `react: true` adds react-hooks rules and the module boundary guard:
 * browser code (apps/web) must not import the server-only
 * `@nightwatch/shared` or the backend implementation `@nightwatch/api`;
 * browser-safe contracts come from `@nightwatch/api-contract` only.
 *
 * `apiService: true` forbids Hono imports in service files: business
 * logic must stay transport-independent; HTTP wiring lives in routes
 * and app composition only.
 */
export function createConfig({ react = false, apiService = false } = {}) {
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
              // Boundary: browser apps must never pull in server-only code.
              "no-restricted-imports": [
                "error",
                {
                  patterns: [
                    {
                      group: ["@nightwatch/shared", "@nightwatch/shared/*"],
                      message:
                        "@nightwatch/shared is server-only. Browser code must import contracts from @nightwatch/api-contract.",
                    },
                    {
                      group: ["@nightwatch/api", "@nightwatch/api/*"],
                      message:
                        "Frontend must never import backend implementation code. Share contracts via @nightwatch/api-contract.",
                    },
                  ],
                },
              ],
            },
          },
        ]
      : []),
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
