---
name: implement-issue
description: Implement one approved GitHub issue or one approved Technical Spec file and open a merge-ready PR
argument-hint: "<issue URL or number | path to spec.md>"
disable-model-invocation: true
---

Use skill:`task-delegation` and skill:`git-workflow`.

Run this command in a main session started as agent:`tech-lead` (`claude --agent tech-lead`); workers have no `Agent` tool and cannot dispatch it. The Technical Lead reads the issue (or the given spec), writes the Technical Spec when the source is an issue, splits and dispatches Tasks, reviews and decides, and never edits code. Workers implement, run checks and commit; agent:`software-engineer` as integration owner pushes and opens the PR.

Require one argument: a GitHub issue URL or number, or the path to a Technical Spec file. Implement it end to end per the source, repository instructions, accepted specs, dependencies and acceptance criteria.

## Spec file as the source

An argument that is an existing path ending in `spec.md` under `docs/features/` is a spec source; anything else is an issue.

- Stop and report the blocker unless the spec has `Status` Approved and a date in `Approved by user`. Never select among matching specs and never approve one.
- The spec is the source of truth: do not rewrite it. A contract change goes back to the user per skill:`technical-spec`.
- Running this command with the path is the user's start authorization for the spec's scope-now Tasks only. Never start a deferred Task.
- The path overrides the spec's `Start authorization: None` and `COMMIT_MODE: none` as stated below. Stop when an open decision blocks a scope-now Task.
- Work in the spec's Task order. Open one PR for the scope-now Tasks; when the spec orders separate PRs or merge gates, finish the first merge-ready PR, report the next one and stop.
- Name the branch for the spec folder. The PR body has no closing issue: write `Closes: none` and cite the spec path and the Task IDs delivered.

## Authorization

- Start now. For an issue, the issue is the approved scope and this command approves the Technical Spec: write the spec per skill:`technical-spec` and continue; stop only for an open decision the issue does not settle. For a spec file, the spec is already approved (see above).
- Override any existing `COMMIT_MODE: none` with `COMMIT_MODE: owned-slice`.
- Set `STOP_AT: merge-ready`.
- You may commit, push the current working branch and open one PR for this source. If the current branch is the default branch, work on a new branch named for the issue (or the spec folder). This overrides, for this source only, the rules that forbid workers to push or open a PR.
- Do not merge the PR or start dependent follow-up work.

Complete the implementation and tests, plus runtime smoke checks, accessibility checks and `PROOF` where the issue or spec requires them.

After all writers stop:

1. Run final code review and resolve all in-scope findings.
2. Run every required focused check and the repository's full quality gates.
3. Push and open the PR only when all required local checks pass. If any required check fails or is not run, report the blocker without claiming completion or opening a PR.
4. Wait for required PR CI checks to pass, then report the work as merge-ready.

The PR body follows file:`.github/PULL_REQUEST_TEMPLATE.md` with every section filled: summary with the closing issue, delivered and not delivered, risks, what changed, evidence per requirement, and gate results on the head SHA. Where the issue or spec requires `PROOF`, security or isolation evidence, it carries one result line per criterion; the full handoff goes to the Technical Lead, not the PR. The Technical Lead reviews it with command:`/review-pr`.

Return the PR URL, commit SHA, implementation summary, review and verification results, CI status, and confirmation that the PR is unmerged and no dependent work started.
