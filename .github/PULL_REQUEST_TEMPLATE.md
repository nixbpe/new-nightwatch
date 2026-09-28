<!--
Every section is required. /review-pr treats a missing section, a gate
without a result, or a claim without proof as a Blocker. State outcomes;
the reviewer knows what each gate runs, so give results, not procedure.
-->

## Summary

<!--
Lead with the result: what works now, for whom, and the issue or AC it serves.
Then what it enables or what remains, written as the next step, not as a fault.
-->

Closes #

Out of scope:

## Changes

<!-- What changed and why, in reading order. Name changed contracts (API, schema, RLS, queue payloads, env names) and the docs updated for them. -->

-

## Acceptance

<!-- One row per AC-<NN> or issue requirement this PR claims. -->

| Criterion | Proof (test, scenario or command) | Result (observed pass / observed fail / not verified) |
| --------- | --------------------------------- | ----------------------------------------------------- |
|           |                                   |                                                       |

## Evidence

<!--
- UI: before and after screenshots of the changed surface on desktop
  (1440×900) in both themes. Narrow screens and 200% text follow
  docs/design-system.md LAY-02 in implementation, not here.
- DB/RLS, security or concurrency: the scenario, the trigger, the state it
  reached and the state it preserved.
-->

## Gates

<!-- Result only, no command output. "not run" is a valid result; a blank is not. Every gate runs on the head SHA. -->

Head SHA:

| Gate                                                                         | Result (pass / fail / not run) | Notes |
| ---------------------------------------------------------------------------- | ------------------------------ | ----- |
| validate                                                                     |                                |       |
| integration                                                                  |                                |       |
| coverage (`COVERAGE_GATE=1`)                                                 |                                |       |
| build                                                                        |                                |       |
| security                                                                     |                                |       |
| e2e (local; required when the diff touches apps/web, e2e or user-facing API) |                                |       |

- PR CI on the head commit:
- Independent review (agent:code-reviewer): Blocker / Major / Minor counts and IDs:

## Risks and follow-ups

<!-- Known risks, flaky observations (even if a retry passed), deferred items with issue numbers, open decisions with their owner. -->

-

## Author checklist

- [ ] Only owned, in-scope files changed
- [ ] Tests and docs updated for every changed contract
- [ ] Every gate ran on the head SHA; database-touching gates through `scripts/dev-env.mjs`, never an ambient database
- [ ] UI change: desktop (1440×900) screenshots in both themes attached
- [ ] No secrets, generated noise or build output committed
- [ ] Not merged by the author; no release approval implied
