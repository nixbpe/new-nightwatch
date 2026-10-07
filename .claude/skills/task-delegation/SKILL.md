---
name: task-delegation
description: Split approved work into owned Tasks, coordinate writers and evidence, and finish at the authorized review-ready or merge-ready state.
---

# Task Delegation

## What this is for

Coordinate work within repository role permissions. Delegate only when separate ownership or role limits require it. Release preparation remains a separate, user-authorized flow.

## 1. Split the work into Tasks

Use the current request, issue or named spec as the source. Keep routine assignments in the handoff; no separate planning file is required. Keep cross-cutting contracts and dependencies in a Technical Spec when needed.

Each Task names its owner, outcome, source, owned files and verification. Include prerequisites, invariants, non-goals and sibling contracts only when they affect the assignment.

Split by behavior, failure or permission boundary, and application versus platform ownership. Give one owner the complete behavior, callers, errors, and regression proof. Do not create an agent per AC.

Use `parent` for containment, not dependency. Resolve contracts and prerequisites before dispatch. Give shared files one integration owner. Map every criterion to a Task or integrated verification.

## 2. Assign the Tasks

Choose registered roles by outcome and permissions. Separate application behavior, API, UI, schema, migrations, and tests from environment, CI/CD, infrastructure, secrets, observability, and runbooks. Include platform target, provider, and budget constraints. Deployment requires explicit user authorization.

For each assignment:

- Name the role for model routing. Include criteria, contracts, binding, sibling ownership, `COMMIT_MODE`, and the procedure skills to load. Workers do not select additional skills themselves.
- Point `SOURCE` to the request, issue criteria or relevant spec headings and AC IDs. Send the assigned Task and shared invariants, not the whole Feature or raw logs. Require the owner to trace named contracts and consumers before editing.
- Dispatch independent Tasks together only with disjoint ownership. Send repeated assignments to one worker separately.
- For software implementation, use `/build NODE-<id>`, never `/build auto` or bare `auto`/`all`. While siblings write, `VERIFY` replaces full-suite and build steps.
- Supply the assigned implementation and handoff procedures. Include security checks for authentication, input, organization data, or credentials; debugging for failures; and release procedures only for authorized release work. Static reviewers do not run code.

Set commit authority from the user's authorization:

- `none`: workers never commit; bind by manifest. Use this when authority is unclear.
- `owned-slice`: name shared-file owners and dependency order. After focused checks, stage owned files and commit one behavior with proof. Cross-slice behavior commits once at integration, when its contract is ready. Never make scaffold-only commits.

Commit permission does not authorize push, PR creation, deploy, force-push, or history rewrite. Ask about commits only when the user wants them.

Require a short handoff with `OWNER`, `CHANGED FILES`, `PROOF`, and any `BLOCKER`. Add a details link only when a separate artifact exists. Proof includes per-criterion results and scanner coverage. Open details only for unresolved claims. Track Task, owner, state, candidate triple, open finding IDs, and blockers.

## 3. Wait without polling

Wait for delivered results with a finite timeout. Timeout is not failure; delivery does not prove work started, and a running agent does not prove progress.

Inspect once after a missing result, stalled work, or concrete doubt. Use saved results, wait for new activity, request one checkpoint from an idle worker, or re-dispatch through an authorized route after confirmed failure. Do not inspect again without a new trigger or restart work without new evidence or assignment.

Move ownership only after the previous owner names changed files and confirms mutation stopped. Later edits are out of scope. Report milestones, blockers, and state changes, not waiting. Mark unknowns and runtime limits without guessing causes.

## 4. Build to review-ready

1. Start ready, disjoint Tasks. Require behavioral slices; no candidate exists yet.
2. For code edits, review each Task against criteria, contracts, and non-goals before dependent work starts. Return Blocker/Major findings to its owner. Require evidence for each claim, including stateful triggers, mutations or interleavings, and preserved state. Data-writing integration tests need run-unique fixtures and owned cleanup. Mark missing proof source-complete, not author-verified.
3. After sibling writers stop, run focused checks and smoke tests, including required DB/RLS and security checks. Let the integration owner settle lockfiles, generated output, formatting, and docs. Close proof gaps.

With `STOP_AT: review-ready`, stop and report each check as passed, failed, or not run.

## 5. Finish at merge-ready

With `STOP_AT: merge-ready`, continue after step 3:

1. Obtain one final independent review for code edits, covering integration and changes since Task reviews.
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
