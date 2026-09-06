# Quality gates

Root-level notes for the platform quality scripts. Scripts themselves live in
the root `package.json`; this file records where policies live and how the
scripts are meant to evolve.

## Coverage policy

- Thresholds (80% lines / statements / functions, 70% branches) live in **each
  app's `vitest.config`** (`apps/api`, `apps/web`). Do not duplicate them at
  the root.
- Root `test:coverage` is `turbo run test:coverage`: it passes through to the
  app-level coverage runs and collects their reports; the root sets no
  thresholds of its own.
- Coverage is always measured and reported. Thresholds **fail the run only
  when `COVERAGE_GATE=1`** is set in the app's environment. The gate turns on
  at the first domain feature: set `COVERAGE_GATE: "1"` in the CI `test` job
  env and document it in the release checklist — no config rewrite needed.

## Security script shape

- `security` chains `security:audit` → `security:secrets` → `security:sast`
  (sequential, fail-fast).
  - `security:audit` → `bun audit --audit-level=high` (critical/high fail)
  - `security:secrets` → gitleaks with `.gitleaks.toml`
  - `security:sast` → semgrep registry packs `p/typescript` +
    `p/security-audit` with `--error`
- `security:image` → docker build + trivy `--severity HIGH,CRITICAL
  --exit-code 1` once `apps/api/Dockerfile` exists; skips with a message
  otherwise. Scanner execution errors must fail — never swallow a scanner
  non-zero exit as a pass.
