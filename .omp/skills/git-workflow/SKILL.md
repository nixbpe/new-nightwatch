---
name: git-workflow
description: Structures git workflow practices. Use when making any code change. Use when committing, branching, resolving conflicts, splitting uncommitted work in a messy working tree into clean atomic commits, opening or reviewing a pull request (PR), pushing to a remote, or when you need to organize work across multiple parallel streams.
---
# Git Workflow

## Overview

Git is your safety net. Treat commits as save points, branches as sandboxes, and history as documentation. With AI agents generating code at high speed, disciplined version control is the mechanism that keeps changes manageable, reviewable, and reversible.

## When to Use

Always. Every code change flows through git.

## Core Principles

### Trunk-Based Development (Recommended)

Keep `main` always deployable. Work in short-lived feature branches that merge back within 1-3 days — long-lived branches diverge, create merge conflicts, and delay integration.

```
main ──●──●──●──●──●──●──  (always deployable)
        ╲      ╱  ╲    ╱
         ●──●─╱    ●──╱    ← short-lived feature branches (1-3 days)
```

Teams using gitflow or long-lived branches can adapt the same principles (atomic commits, small changes, descriptive messages) to their branching model. Release branches are acceptable when stabilizing a release while main moves forward; prefer feature flags over long branches for incomplete work.

### 1. Commit Early, Commit Often

Each successful increment gets its own commit — don't accumulate large uncommitted changes. Commits are save points: if the next change breaks something, revert to the last known-good state instantly.

### 2. Atomic Commits

Each commit does one logical thing:

```
# Good
a1b2c3d Add task creation endpoint with validation
d4e5f6g Add task creation form component

# Bad
x1y2z3a Add task feature, fix sidebar, update deps, refactor utils
```

### 3. Descriptive Messages

Explain the *why*, not just the *what*:

```
feat: add email validation to registration endpoint

Prevents invalid email formats from reaching the database, using
Zod at the route handler level (consistent with auth.ts).
```

**Format:** `<type>: <short description>`, then a blank line and an optional body explaining why. **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

### 4. Keep Concerns Separate

Don't combine formatting, refactors, and features in one commit — ideally not in one PR either. Small cleanups (renaming a variable) can still ride along in a feature commit at reviewer discretion; keeping the rest separate makes each change easier to review, revert, and understand in history.

### 5. Size Your Changes

Target ~100 lines per commit/PR; split anything over ~1000. See `code-review-and-quality` for splitting strategies on large changes.

## Branching Strategy

- One feature per branch (`feature/task-creation`), branched from `main`
- Keep branches short-lived (merge within 1-3 days) and delete them after merge
- Prefer feature flags over long-lived branches for incomplete features

**Naming:** `feature/<desc>`, `fix/<desc>`, `chore/<desc>`, `refactor/<desc>`.

For running several agents on parallel branches simultaneously, see `WORKTREES.md`.

## The Save Point Pattern

```
Makes a change → test passes? → commit → continue
              └→ test fails?  → revert to last commit → investigate
```

You never lose more than one increment of work. If an agent goes off the rails, `git reset --hard HEAD` takes you back to the last successful state.

## Change Summaries

After any modification, provide a structured summary:

```
CHANGES MADE:
- src/routes/tasks.ts: Added validation middleware to POST endpoint

THINGS I DIDN'T TOUCH (intentionally):
- src/routes/auth.ts: Has similar validation gap but out of scope

POTENTIAL CONCERNS:
- Added zod as a dependency (72KB gzipped)
```

This catches wrong assumptions early. The "DIDN'T TOUCH" section matters most — it shows you exercised scope discipline instead of an unsolicited renovation.

## Pre-Commit Hygiene

**Before every commit:** run the applicable quality gates in Quality scripts before reporting completion, when source code changed. Documentation-only changes don't require them.

## Handling Generated Files

- **Commit generated files** only if the project expects them (`package-lock.json`, Prisma migrations)
- **Don't commit** build output, `.env`, or unshared IDE config
- **`.gitignore`** should cover `node_modules/`, `dist/`, `.env`, `.env.local`, `*.pem`

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll commit when the feature is done" | One giant commit is impossible to review, debug, or revert. Commit each slice. |
| "The message doesn't matter" | Messages are documentation. Future you (and future agents) need to understand what changed and why. |
| "I'll squash it all later" | Squashing destroys the development narrative. Prefer clean incremental commits from the start. |
| "Branches add overhead" | Short-lived branches are free and prevent conflicting work from colliding. Long-lived branches are the problem. |
| "I don't need a .gitignore" | Until `.env` with production secrets gets committed. Set it up immediately. |

## Red Flags

- Large uncommitted changes accumulating
- Commit messages like "fix", "update", "misc"
- Formatting changes mixed with behavior changes
- No `.gitignore`, or committing `node_modules/`/`.env`/build artifacts
- Long-lived branches that diverge significantly from main
- Force-pushing to shared branches

## Verification

- [ ] Commit does one logical thing; message explains the why
- [ ] Tests pass before committing; no secrets in the diff
- [ ] No formatting-only changes mixed with behavior changes
- [ ] `.gitignore` covers standard exclusions
