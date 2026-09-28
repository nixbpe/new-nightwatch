<!--
Written for a technical manager who did not follow the work: plain sentences,
result first. Expand every internal ID (issue, AC, NODE) the first time it
appears; no agent, binding or handoff vocabulary. /review-pr treats a missing
section, a gate without a result, or a claim without proof as a Blocker.
-->

## Summary

<!-- Two to four sentences: the user problem, what works now, and for whom. -->

Closes #

## Delivered and not delivered

- Delivered:
- Not delivered (deliberately, with the issue that will):

## Risks

<!-- Product and operational risks a manager decides on: behavior limits, data or security exposure, rollout dependencies. Process state (CI pending, open review threads) goes under Gates, not here. -->

-

## What changed

<!-- Group by behavior, not by file: what the user or operator sees, then the contracts touched (API, schema, RLS, queue payloads, env names) and the docs updated. File paths only where a reviewer needs them. -->

-

## Evidence

<!--
One row per accepted criterion or issue requirement, one line per claim: what
was exercised and the observed result. Link the trace, screenshot or test name
instead of pasting geometry, test counts, commands or record paths.
- UI: before and after screenshots of the changed surface on desktop
  (1440×900) in both themes. Narrow screens and 200% text follow
  docs/design-system.md LAY-02 in implementation, not here.
- DB/RLS, security or concurrency: the scenario, the trigger, the state it
  reached and the state it preserved.
Not here: binding or manifest digests, environment slot names, db:up/db:down
or cleanup narration, historical-head disclaimers.
-->

| Requirement | How it was checked | Result (observed pass / observed fail / not verified) |
| ----------- | ------------------ | ----------------------------------------------------- |
|             |                    |                                                       |

## Gates

<!-- These six rows only; no extra rows for focused commands, migrations or smoke scripts. Result only, no command output. "not run" is a valid result; a blank is not. Every gate runs on the head SHA. Notes only for fail, not run or a skip, in one clause. -->

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
- Independent code review: Blocker / Major / Minor counts and IDs:
- Open review threads or pending re-reviews:

## Author checklist

- [ ] Only owned, in-scope files changed
- [ ] Tests and docs updated for every changed contract
- [ ] Every gate ran on the head SHA; database-touching gates through `scripts/dev-env.mjs`, never an ambient database
- [ ] UI change: desktop (1440×900) screenshots in both themes attached
- [ ] No secrets, generated noise or build output committed
- [ ] Not merged by the author; no release approval implied
