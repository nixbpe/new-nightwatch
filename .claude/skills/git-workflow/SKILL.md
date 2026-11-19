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

Size commits by coherent behavior and reviewability, not a LOC quota. Keep related mechanical changes together; split independent risks or ownership boundaries.

## Branching Strategy

Use one feature per branch from `main`, following repository naming. Existing prefixes include `feature/<desc>`, `fix/<desc>`, `chore/<desc>`, and `refactor/<desc>`. Delete branches after merge.

Isolate parallel writers in separate worktrees instead of switching a shared directory between branches.

## Safe Checkpoint and Recovery

- Never use repository-wide `git reset --hard`, `git restore`, `git clean`, or stash in a dirty or shared worktree.
- Restore only owned paths or hunks after confirming no later writer touched them. Stop and coordinate when ownership is unclear.
- Prefer isolated worktrees for experiments. Save changes before removing their workspace; do not assume cleanup preserves uncommitted work.
- Before an authorized commit, stage owned paths and inspect `git diff --cached --name-only` and `git diff --cached --check`.
- For an explicitly bound candidate, reconcile staged bytes and deletions with its manifest. Routine commits need no manifest or binding ledger. Unexpected or unrelated staged content still blocks any commit.
- Keep source metrics separate from publication identity. An authorized commit that only advances HEAD does not change source bytes; reuse source evidence where its conditions still hold. Explicitly bound merge or release work retains its binding requirements.
- Treat commit, push, PR creation, deploy, force-push, and history rewrite as separate permissions. Never force-push a shared branch without authorization.

## Change Summaries

Report changed paths, applicable checks, commit SHA and real concerns. Do not produce an untouched-files inventory or repeat the work log.

## Pre-Commit Hygiene

Reuse applicable passing checks for unchanged source. Documentation-only changes need formatting, references and applicable configuration checks, not application gates or code review.

## Handling Generated Files

Commit generated files only when repository policy requires them, including `package-lock.json` or Prisma migrations. Never commit build output, `.env`, or unshared IDE configuration.

Keep appropriate exclusions for `node_modules/`, `dist/`, `.env`, `.env.local`, and `*.pem`. Never add ignore rules that hide in-scope evidence or candidate source.

## Verification

Confirm explicit authority, owned staged paths, atomic scope, a meaningful message, applicable checks, and no secrets or generated noise. Report skipped checks and remaining publication actions separately.
