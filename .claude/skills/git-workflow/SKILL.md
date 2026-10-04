---
name: git-workflow
description: Keep branches, checkpoints, commits, staging, conflicts, and PR publication scoped, authorized, and recoverable.
---

# Git Workflow

## Overview

Follow the repository's branch conventions and the user's publication authority. Passing checks do not authorize commits, push, or merge.

## Core Principles

### Trunk-Based Development (Recommended)

Keep `main` deployable and use short-lived branches, normally 1-3 days. Adapt to established release branches or gitflow; prefer feature flags for incomplete work.

### 1. Checkpoint Early; Commit When Authorized

Use scoped diffs or isolated worktrees for recoverable checkpoints. Commit only with user or assignment authorization and clear ownership.

### 2. Atomic Commits

Commit one logical behavior with its proof. Never absorb unrelated formatting, dependencies, or refactors.

### 3. Descriptive Messages

Use `<type>: <short description>` and an optional body explaining why. Supported types are `feat`, `fix`, `refactor`, `test`, `docs`, and `chore`.

### 4. Keep Concerns Separate

Separate formatting, refactoring, and features. Include a small related cleanup only when the reviewer accepts its scope.

### 5. Size Your Changes

Target ~100 lines per commit or PR. Split changes over ~1000 into independently reviewable units.

## Branching Strategy

Use one feature per branch from `main`, following repository naming. Existing prefixes include `feature/<desc>`, `fix/<desc>`, `chore/<desc>`, and `refactor/<desc>`. Delete branches after merge.

For parallel worktrees, read file:`WORKTREES.md`. Isolate writers instead of switching a shared directory between branches.

## Safe Checkpoint and Recovery

- Never use repository-wide `git reset --hard`, `git restore`, `git clean`, or stash in a dirty or shared worktree.
- Restore only owned paths or hunks after confirming no later writer touched them. Stop and coordinate when ownership is unclear.
- Prefer isolated worktrees for experiments. Save changes before removing their workspace; do not assume cleanup preserves uncommitted work.
- Before an authorized commit, stage owned paths and inspect `git diff --cached --name-only` and `git diff --cached --check`.
- Regenerate or reconcile the candidate manifest so staged bytes and deletions match the accepted worktree binding. Unexpected, ambient, or mismatched staged content blocks the commit.
- Treat commit, push, PR creation, deploy, force-push, and history rewrite as separate permissions. Never force-push a shared branch without authorization.

## Change Summaries

Report CHANGES MADE, THINGS I DIDN'T TOUCH (intentionally), and POTENTIAL CONCERNS. Use exact paths and concrete effects. Omit empty sections rather than retelling the work.

## Pre-Commit Hygiene

Run applicable repository checks before reporting changed source complete. Documentation-only changes do not require application gates; check their formatting and references.

## Handling Generated Files

Commit generated files only when repository policy requires them, including `package-lock.json` or Prisma migrations. Never commit build output, `.env`, or unshared IDE configuration.

Keep appropriate exclusions for `node_modules/`, `dist/`, `.env`, `.env.local`, and `*.pem`. Never add ignore rules that hide in-scope evidence or candidate source.

## Verification

Confirm explicit authority, owned staged paths, atomic scope, a meaningful message, applicable checks, and no secrets or generated noise. Report skipped checks and remaining publication actions separately.
