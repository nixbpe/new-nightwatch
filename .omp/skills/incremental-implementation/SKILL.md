---
name: incremental-implementation
description: Delivers changes incrementally in thin, verifiable slices. Use when implementing any feature or change that touches more than one file, or when picking up the next task from a plan. Use when rolling a change out behind a feature flag, when you're about to write a large amount of code at once, or when a task feels too big to land in one step.
---

# Incremental Implementation

## Overview

Build in thin vertical slices — implement one piece, test it, verify it, then expand. Avoid implementing an entire feature in one pass. Each increment should leave the system in a working, testable state.

## When to Use

- Implementing any multi-file change
- Building a new feature from a task breakdown
- Refactoring existing code
- Any time you're tempted to write more than ~100 lines before testing

**When NOT to use:** Single-file, single-function changes where the scope is already minimal.

## The Increment Cycle

```
Implement ──→ Test ──→ Verify ──→ Commit ──→ Next slice
                          │
                     (on failure)
                          ▼
                    fix, then retry
```

1. **Implement** the smallest complete piece of functionality
2. **Test** — run the test suite (or write a test if none exists)
3. **Verify** — tests pass, build succeeds, manual check
4. **Commit** — save progress with a descriptive message (see skill:`git-workflow`)
5. **Move to the next slice** — carry forward, don't restart

## Slicing Strategies

| Strategy | Use when | Example |
|---|---|---|
| **Vertical (preferred)** | Default — one complete path through the stack per slice | Slice 1: create a task (DB+API+UI) → tests pass, user can create one. Then list, edit, delete |
| **Contract-first** | Backend and frontend must develop in parallel | Define the API contract first; each side builds against it; integrate last |
| **Risk-first** | The riskiest or most uncertain piece needs proving early | Prove the hard part (e.g. a WebSocket connection) before building features on top of it |

## Implementation Rules

### Rule 0: Simplicity First

Before writing any code, ask: "What is the simplest thing that could work?" After writing it: can this be done in fewer lines, are these abstractions earning their complexity, would a staff engineer say "why didn't you just..."?

```
✗ An interface with one implementation          →  ✓ Just the implementation
✗ A factory for one product                      →  ✓ A plain constructor or function
✗ A config knob for a value that never changes   →  ✓ A constant
```

Implement the naive, obviously-correct version first. Optimize only after correctness is proven with tests. Prefer deletion over addition, and boring over clever — clever is what someone else decodes at 3am.

### Rule 0.1: Understand Before You Minimize

Trace the whole thing first — every file the change touches, the actual flow — before picking the smallest fix. Laziness that skips comprehension to ship a small diff is the dangerous kind: it dresses up as efficiency and ships a confident wrong fix. Read fully, then be lazy.

Fewest files and the shortest working diff win, but only once you understand the problem — the smallest change in the wrong place isn't lazy, it's a second bug. And "lazy" never means picking the flimsier of two equally simple options: if two standard-library approaches are the same size, take the one that's correct on edge cases.

### Rule 0.2: Never Simplify Away Safety

Simplicity has a floor. Never simplify away input validation at trust boundaries, error handling that prevents data loss, security measures, accessibility basics, or anything the user explicitly requested. If the user insists on the full version, build it — don't re-argue for the simpler one.

### Rule 0.5: Scope Discipline

Touch only what the task requires. Do NOT clean up adjacent code, refactor imports you're not touching, remove comments you don't understand, or add unrequested features. Note anything worth improving outside scope instead of fixing it:

```
NOTICED BUT NOT TOUCHING: src/utils/format.ts has an unused import (unrelated to this task)
→ Want me to create a task for this?
```

### Rules 1–5

| Rule | Statement |
|---|---|
| One thing at a time | Each increment changes one logical thing — don't mix a new component, a refactor, and a config update in one commit |
| Keep it compilable | The project must build and existing tests must pass after every increment |
| Feature flags | If a feature isn't ready for users but you need to merge, gate it behind a flag defaulted off, rather than leaving it on a branch |
| Safe defaults | New code defaults to conservative, opt-in behavior (e.g. a new `notify` option defaults to `false`) |
| Rollback-friendly | Prefer additive changes; keep modifications minimal; never delete something and replace it in the same commit |

## Working with Agents

When directing an agent: be explicit about what's in scope and what's NOT in scope for this increment, and require it to run the repository's test and build commands before reporting done.

## Increment Checklist

- [ ] The change does one thing and does it completely
- [ ] All existing tests still pass, and the build succeeds
- [ ] Type checking and linting pass, where the stack has them
- [ ] The new functionality works as expected
- [ ] The change is committed with a descriptive message

**Note:** Run each verification command after a change that could affect it — don't repeat an unchanged command for reassurance.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll test it all at the end" | Bugs compound. A bug in Slice 1 makes Slices 2-5 wrong. Test each slice. |
| "These changes are too small to commit separately" | Small commits are free. Large commits hide bugs and make rollbacks painful. |
| "I'll add the feature flag later" | If the feature isn't complete, it shouldn't be user-visible. Add the flag now. |
| "This refactor is small enough to include" | Refactors mixed with features make both harder to review and debug. Separate them. |

## Red Flags

- More than 100 lines of code written without running tests
- Multiple unrelated changes in a single increment
- "Let me just quickly add this too" scope expansion
- Build or tests broken between increments
- Building abstractions before the third use case demands it
- Touching files outside the task scope "while I'm here"

## Verification

- [ ] Each increment was individually tested and committed
- [ ] The full test suite passes and the build is clean
- [ ] The feature works end-to-end as specified
- [ ] No uncommitted changes remain
