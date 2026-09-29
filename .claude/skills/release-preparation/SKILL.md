---
name: release-preparation
description: Separate flow that takes a merged or merge-ready change to release-ready - target environment checks, deploy readiness evidence, candidate binding, the full release gates and a final delta review. Used only when the user asks to prepare a release or deployment.
argument-hint: "<Feature id, PR number or URL>"
---

# Release Preparation

## What this is for

Implementation stops at review-ready or merge-ready. Preparing a release is its own task: check the target environment, lock the exact code with a fingerprint, run the full gates against it, and finish with a final review. Any file change after the lock breaks it and the affected checks run again. Release and deploy approval stay with people.

## Running it as a command

Run in a main session started as the Technical Lead (`claude --agent tech-lead`). Require one Feature id, PR number or URL that names a merge-ready change; if it is not merge-ready, stop and say so. The run stops at `release-ready`. Deployment or production actions need the user's exact target and scope, relayed to the platform worker.

## 1. Environment readiness

agent:`platform-engineer` returns one checkpoint with evidence:
- TLS, allowed origins, secrets, replica counts, credentials and database permissions in the target environment;
- database, Redis and Compose readiness, the shared-lifecycle owner, the env names each gate needs (never values) and the frozen migration digest;
- deployment and migration effects (data compatibility, health checks, rollback limits), operability of the changed path, and a recovery runbook entry;
- task-owned services, containers and volumes with their state and cleanup owner.

An environment failure names its cause and each affected gate.

## 2. Candidate binding

- States run `mutating → source-complete → reviewed → bound → validating → release-ready`; report only the current one. Any source edit returns to `mutating` and review.
- Bind a snapshot taken after all writers stopped: a clean commit SHA, or `bun run candidate:manifest` output. Name it `<Feature-id>-C<n>` with its `acceptanceVersion` and manifest digest; every review and gate cites that triple.
- A bound candidate is immutable. Any changed file, including formatter or generated output, invalidates it: report `<id> → invalidated`, repair, and bind the next id naming the superseded candidate and the addressed finding IDs.

## 3. Release gate

In parallel, agent:`software-engineer` runs the application gates without editing and agent:`platform-engineer` runs the scanners, both against the binding:
```text
bun run validate
bun run test:integration
COVERAGE_GATE=1 bun run test:coverage
bun run e2e
bun run security
bun run security:image
```
PR CI never runs `e2e`; only the human-dispatched `full` job does, so run it locally or report it not verified.

agent:`code-reviewer` then reviews the bound evidence. The Technical Lead accepts the candidate only when, on the same binding, every required criterion is observed pass and every manifest file, including deleted paths, is scanned or scanner-skipped with reason (`nonCandidateExclusions` are reconciled separately). Missing, mismatched or not-verified evidence blocks acceptance; author-produced results are not independent evidence.

Scanner evidence from agent:`platform-engineer`: candidate binding, command, tool version, configuration, execution identity, date, exit code and result location, plus every candidate manifest path accounted as scanned or scanner-skipped with reason. Deletions count as skipped. Non-candidate exclusions are listed separately and never waive scanning of candidate source.

Bound-evidence review by agent:`code-reviewer`: judge pass or fail only from bound gate evidence, verify that every producer result names the same binding and scope, account every manifest file as scanned or scanner-skipped with reason (including deletions), reconcile `nonCandidateExclusions` separately as outside the candidate, and map each required criterion to observed pass, observed fail or not verified.

Final delta review of a frozen candidate checks only that the candidate matches its manifest, prior findings are closed against their evidence, repairs introduced no new regression, the full-verification evidence is bound to this exact candidate, and no out-of-scope observation is mixed in rather than filed as a follow-up. The verdict is APPROVED, or CHANGES_REQUESTED naming Blocker/Major finding IDs. An addition that violates neither the frozen acceptance matrix nor an existing architecture invariant is not a finding.

## 4. Repair and cap

Collect all findings and failed gates into one batch, repair with the focused checks in skill:`delivery-orchestration` step 5, rerun only the failed gates, and never send a candidate with a red gate to final review. Allow one repair cycle and one final delta review; a reproducible Blocker or Major found there gets a second and last cycle. Minor issues become follow-ups, and a new requirement goes through the After freeze rules in skill:`technical-spec`. When the cap is used up, stop and give the user the evidence and the decision needed.

## 5. Done

Release-ready means acceptance is frozen, every accepted finding is fixed, the release gate is green, the environment checkpoint passed and the final delta review is approved, with no file changed since the gates ran.
