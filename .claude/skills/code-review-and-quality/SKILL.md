---
name: code-review-and-quality
description: Conducts static multi-axis code review by reading source, tests and author evidence, without running code. Use before merging any change that edits code. Use when reviewing code written by yourself, another agent, or a human. Use when you need to assess code quality across multiple dimensions before it enters the main branch.
---

# Code Review and Quality

## Overview

Every change that edits code gets reviewed before merge. A change with no code edit (docs-only, config-only or other non-code content) needs no code review, per file:`AGENTS.md`. Review covers five axes: correctness, readability, architecture, security, and performance.

**Static review only.** The reviewer reads source, tests and the author's evidence. It does not run the app, tests, builds, profilers or benchmarks. Where a judgment depends on a runtime fact (a measured latency, a query plan, a bundle size), cite the author's evidence or ask for it; do not estimate one.

**The approval standard:** Approve a change when it definitely improves overall code health, even if it isn't perfect. Perfect code doesn't exist. Don't block a change because it isn't exactly how you would have written it. If it improves the codebase and follows the project's conventions, approve it.

## When to Use

- Before merging any PR or change that edits code
- After completing a feature implementation
- When another agent or model produced code you need to evaluate
- When refactoring existing code
- After any bug fix (review both the fix and the regression test)

## The Five-Axis Review

### 1. Correctness

Does the code do what it claims to do?

- Does it match the spec or task requirements?
- Are edge cases (null, empty, boundary values) and error paths handled, not just the happy path?
- Does it pass all tests? Are the tests actually testing the right things?
- Are there off-by-one errors, race conditions, or state inconsistencies?

### 2. Readability & Simplicity

Can another engineer (or agent) understand this code without the author explaining it?

- Are names descriptive and consistent with project conventions? (No `temp`, `data`, `result` without context)
- Is the control flow straightforward (avoid nested ternaries, deep callbacks)?
- Is the code organized logically (related code grouped, clear module boundaries)?
- Are there any "clever" tricks that should be simplified?
- **Could this be done in fewer lines?** (1000 lines where 100 suffice is a failure)
- **Are abstractions earning their complexity?** (Don't generalize until the third use case)
- Would comments help clarify non-obvious intent? (But don't comment obvious code.)
- Are there dead code artifacts: no-op variables (`_unused`), backwards-compat shims, or `// removed` comments?
- **Is a new conditional bolted onto an unrelated flow?** That's a design smell, not a nit: push the logic into its own helper, state, or policy.
- **Do repeated conditionals on the same shape appear?** They signal a missing model or dispatcher. A "temporary" branch is usually permanent debt.

### 3. Architecture

Does the change fit the system's design?

- Does it follow existing patterns or introduce a new one? If new, is it justified?
- Does it maintain clean module boundaries?
- Is there code duplication that should be shared?
- Are dependencies flowing in the right direction (no circular dependencies)?
- Is the abstraction level appropriate (not over-engineered, not too coupled)?
- **Does this refactor reduce complexity or just relocate it?** Count the concepts a reader must hold to follow the change. If a "cleaner" version leaves that count unchanged, it isn't cleaner. Prefer the restructuring that makes whole branches, modes, or layers disappear over one that re-centralizes the same logic. Prefer deleting an abstraction to polishing it.
- **Is feature-specific logic leaking into a shared or general-purpose module?** Keep logic in its owning layer, reuse the existing canonical helper instead of a near-duplicate, and don't normalize architectural drift.
- **Are type boundaries explicit?** Question gratuitous `any`/`unknown`/optional/casts and silent fallbacks that paper over an unclear invariant; an explicit boundary often simplifies the surrounding control flow.

### 4. Security

Review with the security lens; it holds the checks.

### 5. Performance

Judge from the source. Flag a pattern with a known cost; when the impact depends on data volume or a measured number, ask the author for the evidence instead of guessing. Web Vitals values below are industry references, not project targets; the project sets targets in its own contracts.

**Data access**

- **N+1 queries:** a query or per-item `await` inside a loop. Propose one query with a join/`include`, or a batch by ids.
- **Unbounded fetch:** a list query or endpoint with no limit, pagination or cursor.
- **Predicates that defeat an index:** leading-wildcard `LIKE '%term'`, a function on the indexed column (`lower(email) = ?`; index the expression instead), a composite index with the range or sort column before the equality columns.
- **New index without a stated query shape:** every index taxes each write; ask which query it serves and for the plan before and after.
- **Partial, expression or trigram index missing** where the query shape needs one; unused or duplicate indexes left on a write-heavy table.
- **Loop of single calls** where a bulk operation exists.

**Connections and request path**

- **Pool per request or per module.** Pool `max` times instance count must stay under the database `max_connections`; no `connectionTimeoutMillis`, so exhaustion queues forever. Raising `max` is not a fix until what holds connections is found (long transactions, missing `await`, leaked clients).
- **Synchronous heavy computation** in a request handler.
- **Large responses not compressed.**

**Caching**

- **Cached call not shown to be expensive**, or read rarely relative to writes.
- **Key omits an input the response varies on** (tenant, viewer, locale, permissions, feature flag). This leaks one user's data to another: **Critical**.
- **No staleness window or invalidation strategy**, or more than one strategy layered.
- **Hot key with no stampede guard** (request coalescing, lock or `stale-while-revalidate`).
- **Data cached whose staleness is a correctness bug** (balances, permissions); origin errors cached; negative results cached with the same TTL as hits.
- **No eviction policy or memory ceiling** on an in-process or shared cache.
- **Write strategy mismatched to the need:** write-through adds cache latency to every write; write-behind loses data if the cache dies before the flush.

**Frontend**

- **New object, array or function literal passed as a prop** to a memoized child, so the memo never hits.
- **`React.memo`/`useMemo`/`useCallback` on everything** with no profiling evidence; over-use is as much a finding as under-use.
- **Heavy library imported statically** into a route that could `lazy(() => import(...))`; route-level code splitting missing.
- **Images:** no `width`/`height`; below-the-fold image without `loading="lazy"`; LCP image lazy-loaded or without `fetchpriority="high"`.
- **Long lists rendered without virtualization**; off-screen sections without `content-visibility: auto`.
- **Long tasks (> 50ms) in an event handler** with no `scheduler.yield()` or `yieldToMain`, the main lever for INP (reference: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1); non-urgent work (analytics, logging) run inside the handler.
- **Layout thrashing** (reads and writes interleaved in one handler); animation on properties other than `transform` and `opacity`.
- **Third-party script** loaded without `async`/`defer`; non-critical CSS that blocks rendering.
- **Fonts:** many families or weights, not self-hosted WOFF2, no `font-display: swap`, LCP font not preloaded.
- **Network:** static assets without long `max-age` and content hashes; unnecessary redirects; `unload` handlers or `Cache-Control: no-store` on HTML, which lose bfcache eligibility.

**Speculative optimization**

- Complexity added "for performance" with no cited before/after numbers from the author. Ask for them; an optimization that shows no measurable gain is not worth keeping.
- An "optimization" that drops work the product needs (skipped validation, cached data that must be fresh, a removed load-bearing `await`) is a regression.
- A test changed, skipped or deleted to make an optimization pass.

## Structural Remedies

When you flag a structural problem, propose the move, not just the problem. Reach for a named restructuring:

- **Replace a chain of conditionals** with a typed model or an explicit dispatcher.
- **Collapse duplicate branches** into a single clearer flow.
- **Separate orchestration from business logic** so each reads on its own.
- **Move feature-specific logic** out of a shared module into the package that owns the concept.
- **Reuse the canonical helper** instead of a bespoke near-duplicate.
- **Make a type boundary explicit** so downstream branching disappears.
- **Delete a pass-through wrapper** that adds indirection without clarifying the API.
- **Extract a helper, or split a large file** into focused modules.

Prefer the remedy that removes moving pieces over one that spreads the same complexity around.

## Change Sizing

Flag a change over ~300 changed lines, one that mixes refactoring with new behavior, or one that grows an already-large file (~1000 lines) without decomposing it, and propose the split: stack, by file group, horizontal (shared code first) or vertical (full-stack slices). Complete file deletions and automated refactors may be large.

## Review Process

### Step 1: Understand the Context

```
- What is this change trying to accomplish?
- What spec or task does it implement?
- What is the expected behavior change?
```

### Step 2: Review the Tests First

Tests reveal intent and coverage:

```
- Do tests exist for the change?
- Do they test behavior (not implementation details)?
- Are edge cases covered?
- Do tests have descriptive names?
- Would the tests catch a regression if the code changed?
```

### Step 3: Review the Implementation

```
For each file changed:
1. Correctness: Does this code do what the test says it should?
2. Readability: Can I understand this without help?
3. Architecture: Does this fit the system?
4. Security: Any vulnerabilities?
5. Performance: Any anti-pattern from the list above?
```

### Step 4: Categorize Findings

Label every comment with its severity so the author knows what's required vs optional:

| Prefix | Meaning | Author Action |
|--------|---------|---------------|
| *(no prefix)* | Required change | Must address before merge |
| **Critical:** | Blocks merge | Security vulnerability, data loss, broken functionality |
| **Nit:** | Minor, optional | Author may ignore (formatting, style preferences) |
| **Optional:** / **Consider:** | Suggestion | Worth considering but not required |
| **FYI** | Informational only | No action needed |

**Lead with what matters.** Order findings by leverage: correctness and security first, then structural regressions and missed simplifications, then everything else. A few high-conviction comments beat a long list. If you have one structural problem and ten nits, the structural problem *is* the review.

### Step 5: Verify the Verification

Check the author's verification story as evidence, without re-running it:

```
- Which tests does the author report, and do they cover the change?
- Is the build result reported?
- Is manual testing described?
- Are there screenshots for UI changes?
- Is there a before/after measurement for a performance claim?
```

Report a missing item as a gap. Do not run tests, builds or profilers to fill it.

## Multi-Model Review Pattern

Use different models for different review perspectives, since different models have different blind spots:

```
Model A writes the code
    │
    ▼
Model B reviews for correctness and architecture
    │
    ▼
Model A addresses the feedback
    │
    ▼
Human makes the final call
```

**Example prompt for a review agent:**
```
Review this code change for correctness, security, and adherence to
our project conventions. The spec says [X]. The change should [Y].
Flag any issues as Critical, Required, Optional, or Nit.
```

## Review Speed

Slow reviews block entire teams; the cost of context-switching to review is less than the waiting cost imposed on others.

- **Respond within one business day**, the maximum, not the target
- **Ideal cadence:** Respond shortly after a review request arrives, unless deep in focused coding. A typical change should complete multiple review rounds in a single day
- **Prioritize fast individual responses** over quick final approval
- **Large changes:** Ask the author to split them rather than reviewing one massive changeset

## Handling Disagreements

When resolving review disputes, apply this hierarchy:

1. **Technical facts and data** override opinions and preferences
2. **Style guides** are the absolute authority on style matters
3. **Software design** must be evaluated on engineering principles, not personal preference
4. **Codebase consistency** is acceptable if it doesn't degrade overall health

**Don't accept "I'll clean it up later."** Deferred cleanup rarely happens. Require cleanup before submission unless it's a genuine emergency. If surrounding issues can't be addressed in this change, require filing a bug with self-assignment.

## Honesty in Review

When reviewing code, whether written by you, another agent, or a human:

- **Don't rubber-stamp.** "LGTM" without evidence of review helps no one.
- **Don't soften real issues.** "This might be a minor concern" when it's a bug that will hit production is dishonest.
- **Quantify problems from the code, not from guesses.** "This loop issues one query per row, so a 100-row page costs 101 queries" is better than "this could be slow." Do not invent latency figures.
- **Push back on approaches with clear problems.** Sycophancy is a failure mode in reviews. Say so directly and propose alternatives.
- **Accept override gracefully.** If the author has full context and disagrees, defer to their judgment. Comment on code, not people.

## See Also

- Detailed security review: file:`../../references/security-checklist.md`

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, that's good enough" | Working code that's unreadable, insecure, or architecturally wrong creates debt that compounds. |
| "I wrote it, so I know it's correct" | Authors are blind to their own assumptions. Every change benefits from another set of eyes. |
| "We'll clean it up later" | Later never comes. Require cleanup before merge, not after. |
| "AI-generated code is probably fine" | AI code needs more scrutiny, not less. It's confident and plausible, even when wrong. |
| "The tests pass, so it's good" | Tests don't catch architecture problems, security issues, or readability concerns. |
| "The refactor makes it cleaner" | Relocating complexity isn't reducing it. Look for the version where branches disappear. |
| "It's only a small addition to this file" | Small diffs still push files past a healthy size and bolt branches onto unrelated flows. Judge the resulting structure, not the diff size. |
| "We'll optimize later" | Fix known anti-patterns (N+1, unbounded fetch, per-request pools) now; defer micro-optimizations. |
| "This optimization is obvious" | Then the author can cite the measurement. Unmeasured wins are how neutral complexity lands. |
| "Just cache it" | Caching a cheap call adds a staleness bug for no gain, and a key that omits the viewer leaks data. |
| "It's just a version bump" | A bump is a behavior change you didn't write. Read the changelog; semver doesn't guarantee no breakage. |
| "I'll upgrade everything in one PR to save time" | A bulk bump that breaks the build hides which package did it. One dependency per change keeps the cause and the revert clean. |

## Red Flags

- PRs merged without any review, or "LGTM" without evidence of review
- Review that only checks if tests pass (ignoring other axes)
- Security-sensitive changes without security-focused review
- Large PRs that are "too big to review properly" (split them)
- No regression tests with bug fix PRs
- Review comments without severity labels
- Accepting "I'll fix it later"
- N+1 query, unbounded list, or cache key missing tenant/viewer in the diff
- Performance complexity added with no author measurement
- Review that runs code or estimates runtime numbers instead of reading the source and the author's evidence

## Verification

After review is complete:

- [ ] All Critical issues are resolved
- [ ] All Required (no-prefix) changes are resolved or explicitly deferred with justification
- [ ] The author's test and build results are reported and cover the change (reviewer did not re-run them)
- [ ] The verification story is documented (what changed, how it was verified)

**Presumptive blockers:** surface and propose the simpler design for each of these; escalate to Required only when the change actively makes structure worse: a refactor that relocates complexity instead of reducing it; a change that pushes a file past the size boundary with no decomposition; feature logic added to a shared module; a near-duplicate of an existing canonical helper; a silent fallback that hides an unclear invariant.

## Simplification

Suggest a simplification only when it preserves behavior exactly. Understand why the code exists (history, tests) before removing it, apply changes one at a time with the tests rerun after each, and revert one that changes behavior or makes the diff harder to review.
