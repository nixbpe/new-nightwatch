---
name: delivery-orchestration
description: How the Technical Lead splits a ready Feature or Story into Tasks, assigns them to workers, waits for results and gets the change to a review-ready state. Use for implement, platform and repair work.
---

# Delivery Orchestration

## What this is for

This is the Technical Lead's day-to-day playbook for building a change: cut the work into Tasks that one owner can finish, hand them out with clear limits, wait for short reports instead of watching agents, and bring the result to the point where a person can review it. Validation to full technical sign-off continues in skill:`candidate-validation`.

## 1. Split the work into Tasks

Show and update the breakdown before dispatch. Do not create planning files or delegate top-level planning.

Each Task declares:
- `OWNER`, `READY`, `OUTCOME` and `SOURCE`
- `INVARIANTS`, `FILES` and `NON-GOALS`
- sibling `CONTRACTS`, permitted `VERIFY` and required `PROOF`

How to cut:
- Split by behavior, failure or permission boundary, and by application versus platform ownership, not by files or steps.
- Keep callers, errors and regression proof with the behavior that owns them.
- Give one owner the whole behavior it can finish, not one agent per AC.
- `parent` is containment, not dependency.
- Put shared files under one integration owner. Resolve contracts first, then dispatch only ready, disjoint work whose prerequisites are done.
- Map every criterion to a Task or to integrated verification; broad labels are not Tasks.

## 2. Assign the Tasks

Route by outcome, not by which worker is free:
- Application behavior, API, UI, schema, migration and tests → agent:`software-engineer` via command:`/build`.
- Environment, CI/CD, containers, infrastructure, secrets, observability and runbooks → agent:`platform-engineer` with target, provider and budget constraints. Deployment requires the user's authorization, relayed by you.

Every dispatch:
- names the exact role, so model routing applies, and includes the gate, criteria, contracts, binding, sibling ownership and `COMMIT_MODE`;
- sends independent Tasks together, and repeated assignments to one worker separately;
- starts a software Task with `/build NODE-<id>` and its fields, never `/build auto` or bare `auto`/`all`. While siblings write, `VERIFY` replaces full-suite and build steps.

**Commits.** Set `COMMIT_MODE` from the user's actual authorization. If it is unclear use `none`, and ask only when the user wants commits.
- `none`: workers never commit; bind by manifest.
- `owned-slice`: name shared-file owners and dependency order. After focused verification each owner stages only in-scope files, commits one behavior with its regression proof and sends the SHA to the integration owner. Behavior that spans slices commits once at fan-in, when its contract is ready. No scaffold-only commits.
- Commit authority never covers push, PR, deploy, force-push or rewriting an existing PR.

**Reports back.** Implementation and platform workers return a short handoff, not a transcript: `OWNER`, `CHANGED FILES`, `PROOF` (with per-criterion results and scanner coverage), `BLOCKER` and a details link. Open the link only if `PROOF` leaves a claim open. Keep in your own state only Task, owner, state, candidate triple, open finding IDs and blockers.

## 3. Wait without polling

- Wait for results that arrive on their own, with a finite timeout. A timeout alone is not a failure, a delivered message does not mean work started, and a running agent is not proof of progress.
- Inspect jobs, agents, output or history only when a result is missing after the timeout, work stalls or you have a concrete doubt. Do not re-inspect without a new trigger. Then:
  - saved result → use it;
  - new activity → wait again;
  - idle or parked → ask for one bounded checkpoint;
  - failed for good, or nothing running → re-dispatch through an authorized route, report the blocker or stop.
- Do not restart work without a new assignment or evidence. Report runtime limits without guessing causes.
- Move ownership only after the previous owner names its changed files and confirms it stopped writing there. Its later edits are out of scope, not merge input.
- Report milestones, blockers and state changes, not waiting narration. Mark unknowns as unknown.

## 4. Build to review-ready

1. Dispatch bounded, ready Tasks together only when ownership is disjoint; owners build in slices per skill:`incremental-implementation`, and one slice may cover several ACs. No candidate exists yet.
2. Read every handoff; evidence must exercise each claim.
   - When relevant, stateful proof names one trigger, the mutation or interleaving it reached, and the state it preserved.
   - Integration tests that write data need run-unique fixtures and owned cleanup.
   - If evidence misses an applicable requirement, mark the handoff source-complete, not author-verified.
3. After sibling writers stop, owners run focused verification and smoke-test their behavior, including DB/RLS and security checks the change requires. The integration owner then settles lockfiles, generated files, formatting, docs and environment prerequisites. Close every proof gap now, not after binding.

With `STOP_AT: review-ready`, stop here and report. With `STOP_AT: verified`, continue with skill:`candidate-validation`.
