---
name: code-review-and-quality
description: Review source, tests, and author evidence for correctness, readability, architecture, security, and performance without running code.
---

# Code Review and Quality

## Overview

Review code edits before merge. Non-code changes need no code review under repository instructions.

Keep the review static. Read source, tests, and author evidence; never run the app, tests, builds, profilers, or benchmarks. For runtime-dependent judgments, cite measured author evidence or report the gap. Never estimate latency, query plans, or bundle size.

Approve an improvement that follows accepted contracts and conventions. Do not require your preferred implementation or perfection.

## The Five-Axis Review

### 1. Correctness

Compare the change with its criteria, boundary and failure behavior, tests, and state transitions. Check null, empty, boundary, race, and error paths. Verify that regression tests detect the changed behavior.

### 2. Readability & Simplicity

Check names, control flow, grouping, and module boundaries. Reject no-op variables, compatibility debris, and comments that narrate removed code. Question `temp`, `data`, `result`, `_unused`, and `// removed` without context.

Prefer a complete shorter solution; 1000 lines where 100 suffice is a failure. Do not generalize before the third use case. Repeated conditionals on one shape suggest a missing model or dispatcher. Keep new policy out of unrelated flows.

### 3. Architecture

Check approved patterns, ownership, dependency direction, duplication, and explicit type boundaries. Question circular dependencies, gratuitous `any`, `unknown`, optional values, or casts, and silent fallbacks hiding an unclear invariant.

A refactor must remove complexity, not relocate it. Keep feature logic in its owning module and reuse canonical helpers.

### 4. Security

Apply the assigned security lens and the relevant checks in file:`../../references/security-checklist.md`. Do not treat a general code review as proof that security-sensitive paths were exercised.

### 5. Performance

Identify costs visible in source. Require author measurements when impact depends on volume or runtime behavior. Web Vitals references below are not project targets.

Check these patterns:

- Data access: N+1 queries, per-item `await`, unbounded lists, and missed bulk operations.
- Indexes: leading-wildcard `LIKE '%term'`, `lower(email) = ?` without an expression index, composite order incompatible with equality and range predicates, missing partial, expression, or trigram indexes required by the query shape, and new or duplicate indexes without a query shape or before/after plan.
- Connections: per-request or per-module pools, pool `max` multiplied by instance count exceeding `max_connections`, missing `connectionTimeoutMillis`, leaked clients, and long transactions. Do not raise limits without finding what holds connections.
- Request work: heavy synchronous computation and uncompressed large responses.
- Caches: unproven benefit, omitted tenant, viewer, locale, permission, or flag inputs, undefined staleness, missing or layered invalidation, missing eviction or memory ceilings, stampedes, cached errors, equal TTLs for misses and hits, and stale balances or permissions. A missing identity input can leak data and is Critical. Match write-through or write-behind to durability and latency needs. Write-through adds write latency; write-behind can lose pending data when the cache fails.
- Frontend: unstable props to memoized children, blanket `React.memo`, `useMemo`, or `useCallback` without profiles, heavy static imports instead of `lazy(() => import(...))`, missing virtualization or `content-visibility: auto`, and layout thrashing.
- Images: missing `width` or `height`, below-fold images without `loading="lazy"`, lazy-loaded LCP images, or LCP images without `fetchpriority="high"`.
- Main thread: tasks over 50ms without `scheduler.yield()` or `yieldToMain`, unnecessary synchronous analytics, and animation outside `transform` and `opacity`. Reference values are LCP ≤ 2.5s, INP ≤ 200ms, and CLS ≤ 0.1.
- Delivery: scripts without `async` or `defer`, blocking CSS, excessive font families or weights, missing self-hosted WOFF2, `font-display: swap`, or LCP font preload.
- Network: static assets without content hashes and long `max-age`, unnecessary redirects, and `unload` or `Cache-Control: no-store` that prevent bfcache.

Flag unmeasured optimization, skipped required work or validation, removed load-bearing `await`, and tests changed or disabled to make optimization pass.

## Structural Remedies

Propose a concrete move for each structural finding: typed model or dispatcher, collapsed duplicate branches, separated orchestration, correct ownership, canonical helper reuse, explicit type boundary, deleted pass-through wrapper, or focused module split.

Prefer the remedy that removes concepts rather than redistributing them.

## Change Sizing

Flag changes over ~300 lines, mixed refactoring and behavior, or growth beyond ~1000 lines without decomposition. Propose a stack or cohesive horizontal or vertical split. Complete deletions and automated refactors can be larger.

## Review Process

### Step 1: Understand the Context

Read accepted scope, criteria, contracts, expected behavior, and non-goals.

### Step 2: Review the Tests First

Check behavioral coverage, boundaries, meaningful names, and whether the tests detect a regression.

### Step 3: Review the Implementation

Apply all required axes to changed code and relevant consumers.

### Step 4: Categorize Findings

Use the assignment's severity and disposition rules. Order correctness, security, and structural findings before optional suggestions. Keep defects and evidence gaps distinct.

### Step 5: Verify the Verification

Inspect author test and build results, required manual observations or UI screenshots, and measurements for performance claims. Report gaps without running tools to fill them.

## Multi-Model Review Pattern

Use the assigned lenses on the same candidate and criteria. Model selection, delegation, and disposition belong to the caller. Create no additional workflow.

## Review Speed

Return one finding batch at the assigned checkpoint. Report unreviewable scope instead of silently skipping it.

## Handling Disagreements

Use technical facts over preference, repository style rules for style, engineering principles for design, and consistency that preserves code health. Record unsettled disagreements with evidence for the caller. Author agreement does not replace independent review.

## Honesty in Review

Give evidence for findings and acceptance. Do not rubber-stamp or soften defects. Quantify source-visible work without inventing runtime numbers. Suggest a simpler alternative to a flawed design. Keep surrounding issues separate; never expand scope or assign follow-ups without authority.

## See Also

Use the security checklist above for detailed controls rather than copying them into this review.

## Verification

Check finding dispositions, author proof coverage, and documented verification. The reviewer must not have rerun tests or builds.

Treat structural regressions as presumptive blockers under assigned severity rules only when the change makes structure worse. Examples include relocated complexity, excessive file growth, feature logic in shared modules, duplicated canonical helpers, and invariant-hiding fallbacks.

## Simplification

Understand source history and tests before suggesting removal. Preserve behavior exactly. Apply and test simplifications one at a time through the authorized owner; revert changes that alter behavior or make review harder.
