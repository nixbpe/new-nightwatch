---
name: implement-issue
description: Implement one approved issue or Technical Spec and open an unmerged PR after local and PR verification.
argument-hint: "<issue URL or number | path to spec.md>"
disable-model-invocation: true
---

Require one issue URL or number, or one Technical Spec path. Follow repository instructions and role permissions. Run through an authorized coordinator when implementation, delegation, or acceptance exceeds your role. Do not create an agent for each criterion.

## Spec file as the source

Treat an existing `spec.md` path under `docs/features/` as the source. Otherwise use the issue.

- Require `Status` Approved and a date in `Approved by user`. Never choose among matching specs or approve one yourself.
- Preserve the approved contracts. Return contract changes to the user before implementation.
- The explicit path authorizes starting scope-now Tasks, overriding `Start authorization: None` and `COMMIT_MODE: none` as below. Never start deferred work or work blocked by an open decision.
- Follow Task order. Open one PR unless the spec requires separate PRs or merge gates. In that case, finish the first merge-ready PR, report the next, and stop.
- Name the branch for the spec folder. Write `Closes: none` in the PR body and cite the spec path and delivered Task IDs.

## Authorization

Apply these permissions only to this source:

- For an issue, the command authorizes its scope, approval of the resulting Technical Spec, and implementation. Write the spec from accepted criteria. Stop for decisions the issue does not settle.
- For a spec path, use its existing approval.
- Override `COMMIT_MODE: none` with `COMMIT_MODE: owned-slice`. Set `STOP_AT: merge-ready`.
- If on the default branch, create a branch named for the issue or spec folder. Relay scoped commit permissions to assigned owners. Name one integration owner with sole authority to push the current working branch and open one PR; this overrides worker publication prohibitions only for that owner and this source. Other owners retain only their scoped commit permissions.
- Never merge or start dependent follow-up work.

Implement the source's behavior, tests, runtime smoke checks, accessibility, and required `PROOF`.

After writers stop:

1. Obtain final independent code review when code changed. Resolve in-scope findings under the repository's review rules.
2. Run required focused checks and full local quality gates.
3. Push and open the PR only after required local checks pass. Otherwise report the blocker without claiming completion.
4. Wait for required PR CI and review conditions to pass before reporting merge-ready.

Use the repository's PR template. Include the issue or spec source, delivered scope, risks, per-criterion proof, and gate results on the head SHA. Keep detailed worker handoffs outside the PR body.

Return the PR URL, commit SHA, delivered behavior, review and verification results, CI state, and confirmation that the PR is unmerged and dependent work has not started.
