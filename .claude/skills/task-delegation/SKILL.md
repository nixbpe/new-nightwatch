---
name: task-delegation
description: How the Technical Lead splits a ready Feature or Story into Tasks, assigns them to workers, waits for results and gets the change to a review-ready state. Use for implement, platform and repair work.
---

# Task Delegation

## What this is for

The Technical Lead's playbook for building a change: cut the work into Tasks one owner can finish, hand them out with clear limits, wait for short reports, and bring the result to review-ready or merge-ready. Release preparation is a separate flow in skill:`prepare-release`.

## 1. Split the work into Tasks

The breakdown lives in the user-approved Technical Spec (skill:`technical-spec`). Create no other planning files and delegate no top-level planning.

Each Task declares:
- `OWNER`, `READY`, `OUTCOME` and `SOURCE`
- `INVARIANTS`, `FILES` and `NON-GOALS`
- sibling `CONTRACTS`, permitted `VERIFY` and required `PROOF`

How to cut:
- Split by behavior, failure or permission boundary, and by application versus platform ownership, not by files or steps.
- Give one owner the whole behavior it can finish, with its callers, errors and regression proof; not one agent per AC.
- `parent` is containment, not dependency.
- Put shared files under one integration owner. Resolve contracts first, then dispatch only ready, disjoint work whose prerequisites are done.
- Map every criterion to a Task or to integrated verification; broad labels are not Tasks.

## 2. Assign the Tasks

Route by outcome:
- Application behavior, API, UI, schema, migration and tests → agent:`software-engineer` via command:`/build`.
- Environment, CI/CD, containers, infrastructure, secrets, observability and runbooks → agent:`platform-engineer` with target, provider and budget constraints. Deployment requires the user's authorization, relayed by you.

Every dispatch:
- names the exact role (so model routing applies) and includes the gate, criteria, contracts, binding, sibling ownership, `COMMIT_MODE` and the skills the worker loads (table below);
- sends independent Tasks together and repeated assignments to one worker separately;
- starts a software Task with `/build NODE-<id>` and its fields, never `/build auto` or bare `auto`/`all`. While siblings write, `VERIFY` replaces full-suite and build steps.

**Worker skills.** Workers name no skills themselves; the dispatch tells them which to load with the Skill tool:

| Worker | Load |
|---|---|
| agent:`software-engineer` | skill:`build`, skill:`worker-handoff`; skill:`security-and-hardening` when the Task touches authentication, input handling, organization data or credentials |
| agent:`platform-engineer` | skill:`worker-handoff`; skill:`debugging-and-error-recovery` when a setup, gate or environment fails; skill:`prepare-release` for release work |
| agent:`code-reviewer` | skill:`code-review-and-quality` for static correctness, maintainability and performance review; skill:`security-and-hardening`; skill:`prepare-release` for bound-evidence review |
| agent:`product-owner` | skill:`requirements` |
| agent:`ux-designer` | skill:`technical-spec` after the spec is approved |

**Commits.** Set `COMMIT_MODE` from the user's actual authorization; use `none` if unclear, and ask only when the user wants commits.
- `none`: workers never commit; bind by manifest.
- `owned-slice`: name shared-file owners and dependency order. After focused verification each owner stages only in-scope files, commits one behavior with its regression proof and sends the SHA to the integration owner. Behavior that spans slices commits once at fan-in, when its contract is ready. No scaffold-only commits.
- Commit authority never covers push, PR, deploy, force-push or rewriting an existing PR.

**Reports back.** Implementation and platform workers return a short handoff: `OWNER`, `CHANGED FILES`, `PROOF` (with per-criterion results and scanner coverage), `BLOCKER` and a details link. Open the link only if `PROOF` leaves a claim open. Keep in your own state only Task, owner, state, candidate triple, open finding IDs and blockers.

## 3. Wait without polling

- Wait for results that arrive on their own, with a finite timeout. A timeout is not a failure, a delivered message does not mean work started, and a running agent is not proof of progress.
- Inspect jobs, agents, output or history only when a result is missing after the timeout, work stalls or you have a concrete doubt, and not again without a new trigger. Then:
  - saved result → use it;
  - new activity → wait again;
  - idle or parked → ask for one bounded checkpoint;
  - failed for good, or nothing running → re-dispatch through an authorized route, report the blocker or stop.
- Do not restart work without a new assignment or evidence. Report runtime limits without guessing causes.
- Move ownership only after the previous owner names its changed files and confirms it stopped writing there. Its later edits are out of scope, not merge input.
- Report milestones, blockers and state changes, not waiting. Mark unknowns as unknown.

## 4. Build to review-ready

1. Dispatch ready Tasks together only when ownership is disjoint; owners build in slices per skill:`build` (one slice may cover several ACs). No candidate exists yet.
2. As each handoff arrives, send that Task's diff to agent:`code-reviewer` against its criteria, contracts and non-goals, and return Blocker/Major findings to the owner before dependent Tasks start. Evidence must exercise each claim.
   - When relevant, stateful proof names one trigger, the mutation or interleaving it reached, and the state it preserved.
   - Integration tests that write data need run-unique fixtures and owned cleanup.
   - If evidence misses an applicable requirement, mark the handoff source-complete, not author-verified.
3. After sibling writers stop, owners run focused verification and smoke-test their behavior, including DB/RLS and security checks the change requires. The integration owner then settles lockfiles, generated files, formatting and docs. Close every proof gap now.

With `STOP_AT: review-ready`, stop here and report each check as passed, failed or not run.

## 5. Finish at merge-ready

With `STOP_AT: merge-ready`, continue after step 3:

1. Send the whole change to agent:`code-reviewer` for one final review of how the Tasks fit together and of changes made after their step 2 reviews.
2. Run the same gates as PR CI:
   ```text
   bun run validate
   COVERAGE_GATE=1 bun run test:coverage
   bun run build
   bun run security
   ```
3. Batch review findings and gate failures and repair once. Fix only in-scope defects that break a criterion or contract; record the rest. Find the cause with skill:`debugging-and-error-recovery` first. Repairs run focused checks only (formatter on touched files, lint and typecheck for the affected package, the regression test, a DB scenario or targeted security check only when the finding needs it), then rerun the failed gates.
4. Report merge-ready with the reviewed commit or diff. If a Blocker, Major or red gate remains after that repair, stop and give the user the evidence and the decision needed.

Merge-ready means review and PR CI gates pass. Full E2E, the image scan, candidate binding and environment checks belong to skill:`prepare-release`.
