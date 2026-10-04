---
name: prepare-release
description: Prepare a merge-ready change for release with environment evidence, immutable candidate binding, full gates, and independent acceptance. Never deploy without separate authorization.
argument-hint: "<Feature id, PR number or URL>"
---

# Prepare Release

## What this is for

Release preparation is separate from implementation and PR review. Bind exact source, verify its environment and full gates, and stop at release-ready. Any source change invalidates the binding. People retain release and deployment approval.

## Running it as a command

Require one Feature id, PR number, or URL naming a merge-ready change. Follow repository role permissions and coordinate through an authorized owner. Stop if the change is not merge-ready.

The run stops at `release-ready`. Production actions require the user's exact target and scope plus the external approval gate. Relay that authorization to the assigned platform owner.

## 1. Environment readiness

Require one platform checkpoint with evidence for:

- TLS, allowed origins, secrets, replicas, credentials, and database permissions.
- Database, Redis, and Compose readiness; shared-lifecycle owner; required environment names without values; and frozen migration digest.
- Deployment and migration compatibility, health, rollback limits, operability, and recovery runbook.
- Task-owned services, containers, and volumes, with observed state and cleanup owner.

For a failure, name its cause and affected gates.

## 2. Candidate binding

Use `mutating → source-complete → reviewed → bound → validating → release-ready` and report only the current state. Any source edit returns to `mutating` and review.

After all writers stop, bind a clean commit SHA or `bun run candidate:manifest` snapshot. Name it `<Feature-id>-C<n>` with `acceptanceVersion` and manifest digest. Every review and gate cites that triple.

Any file change, including formatting or generated output, invalidates a bound candidate. Report `<id> → invalidated`, repair, and bind the next id with its superseded candidate and addressed finding IDs.

## 3. Release gate

Assign no-edit application gates and platform scanners to their authorized owners. Independent review consumes their evidence, never substitutes author self-approval.

Run these gates against the binding:

```text
bun run validate
bun run test:integration
COVERAGE_GATE=1 bun run test:coverage
bun run e2e
bun run security
bun run security:image
```

PR CI does not run `e2e`; only the human-dispatched `full` job does. Run locally or report not verified.

For every scanner result, require binding, command, tool version, configuration, execution identity, date, exit code, and result location. Account for every manifest path as scanned or scanner-skipped with reason. Deleted paths count as skipped. Reconcile `nonCandidateExclusions` separately; they never waive scanning of candidate source.

Independent bound-evidence review must verify matching binding and scope, complete manifest accounting, and each criterion as observed pass, observed fail, or not verified. Missing, mismatched, or unverified evidence blocks acceptance.

Final delta review checks manifest identity, proof closing prior findings, absence of repair regressions, full evidence bound to this candidate, and follow-ups for out-of-scope observations. Use APPROVED or CHANGES_REQUESTED with Blocker/Major finding IDs. Additions that violate neither frozen acceptance nor an existing architecture invariant are not findings.

## 4. Repair and cap

Batch findings and failed gates. Diagnose causes and repair with focused checks. If source changes, invalidate and rebind it, then produce required evidence on the new binding. Otherwise rerun failed gates only. Never send a candidate with a failed gate to final review.

Allow one repair cycle and one final delta review. A reproducible Blocker or Major permits a second and last cycle. Record Minor follow-ups. Return new requirements through the approved acceptance-freeze procedure.

At the cap, stop and report the evidence and decision needed. Do not increase the limit or acceptance scope yourself.

## 5. Done

Report release-ready only when acceptance is frozen, accepted findings are fixed, full gates and the environment checkpoint pass, and final delta review is approved on the same unchanged binding. Never claim deployment or release approval.
