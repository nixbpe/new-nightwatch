---
name: task-delegation
description: Split approved work into owned Tasks, coordinate writers and evidence, and finish at the authorized review-ready or merge-ready state.
---

# Task Delegation

## What this is for

Coordinate work within repository role permissions. Delegate only when separate ownership or role limits require it. Release preparation remains a separate, user-authorized flow.

## 1. Split the work into Tasks

Use the current request, issue or named spec. A Task owns one coherent behavioral batch, including callers and regression proof. Keep related mechanical edits together; do not split by file, assertion or LOC saving.

Name the owner, outcome, source, files and verification. Add invariants or dependencies only when they affect the assignment. Routine work needs no separate plan or acceptance matrix.

Split only at behavior, failure, permission or ownership boundaries. Resolve shared contracts before dispatch and give shared files one writer. Use `parent` for containment, not dependency.

## 2. Assign the Tasks

Choose registered roles by outcome and permissions. Separate application behavior, API, UI, schema, migrations, and tests from environment, CI/CD, infrastructure, secrets, observability, and runbooks. Include platform target, provider, and budget constraints. Deployment requires explicit user authorization.

For each assignment:

- Name the role, outcome, owned paths, `VERIFY`, `PROOF`, `COMMIT_MODE` and required procedure skills. Add contract, sibling or binding details only when applicable. Workers do not select additional skills themselves.
- Point `SOURCE` to the request, issue criteria or relevant spec headings and AC IDs. Send the assigned Task and shared invariants, not the whole Feature or raw logs. Require the owner to trace named contracts and consumers before editing.
- Dispatch independent Tasks together only with disjoint ownership. Send repeated assignments to one worker separately.
- For software implementation, use `/build NODE-<id>`, never `/build auto` or bare `auto`/`all`. While siblings write, `VERIFY` replaces full-suite and build steps.
- Supply the assigned implementation and handoff procedures. Include security checks for authentication, input, organization data, or credentials; debugging for failures; and release procedures only for authorized release work. Static reviewers do not run code.

Set commit authority from the user's authorization:

- `none`: leave owned changes uncommitted; use when authority is unclear. Bind by manifest only when the assignment requires it.
- `owned-slice`: name shared-file owners and dependency order. After focused checks, stage owned files and commit one behavior with proof. Cross-slice behavior commits once at integration, when its contract is ready. Never make scaffold-only commits.

Commit permission does not authorize push, PR creation, deploy, force-push, or history rewrite. Ask about commits only when the user wants them.

Use one short handoff with `OWNER`, `CHANGED FILES`, `PROOF` and any `BLOCKER`. Link existing evidence; do not mirror it into multiple status files. Report scanner coverage only when scanners were required or run. Track candidate identities only for bound work.

## 3. Wait without polling

Wait for delivered results with a finite timeout. Timeout is not failure; delivery does not prove work started, and a running agent does not prove progress.

Inspect after a missing result, stalled work or concrete doubt. Use saved results; do not poll or restart completed work for reassurance.

Transfer ownership only after the previous writer stops. Report milestones or blockers, not waiting. Label unknowns and runtime limits.

## 4. Build to review-ready

1. Start ready Tasks with disjoint ownership. Inspect delivered diffs and settle shared contracts before dependent work starts.
2. Check the integrated behavioral batch with affected tests and scoped checks after writers stop. Add DB/RLS, security, runtime or controlled-interleaving proof when the changed boundary requires it. Do not require a fresh baseline, mutation matrix or observer for every fixture extraction. Data-writing integration tests still need isolated fixtures and owned cleanup. Label missing proof `source-complete`, not `author-verified`.
3. Obtain one independent review for the code batch before merge or at the assigned risk checkpoint. Return Blocker/Major findings to the owner. Do not dispatch another review for each mechanical edit or commit. Non-code changes need no code review.

With `STOP_AT: review-ready`, stop and report each check as passed, failed, or not run.

## 5. Finish at merge-ready

With `STOP_AT: merge-ready`, continue from `review-ready`:

1. Reuse the independent review if it covers the final code. Review uncovered integration changes or finding repairs; do not repeat an unchanged whole-batch review.
2. Run the PR CI gates:

   ```text
   bun run validate
   COVERAGE_GATE=1 bun run test:coverage
   bun run build
   bun run security
   ```

3. Batch findings and gate failures into one repair. Fix only in-scope criterion or contract defects; record other findings. Diagnose causes first. Run focused formatting, package lint and typecheck, regression, and applicable DB or security checks, then rerun failed gates.
4. Report the reviewed commit or diff. If Blocker, Major, or a failed gate remains, stop and return evidence and the decision needed.

Merge-ready requires review and PR CI gates. Full E2E, image scans, candidate binding, and environment checks remain release preparation.
