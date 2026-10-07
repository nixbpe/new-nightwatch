---
name: implement-issue
description: Implement one explicitly requested issue or capability change and open an unmerged PR after local and PR verification.
argument-hint: "<issue URL or number | capability and requested change>"
disable-model-invocation: true
---

Follow repository instructions and role permissions. Run through an authorized coordinator when implementation, delegation or acceptance exceeds your role. Do not create an agent for each criterion.

## Source

Use one issue or an explicitly requested capability change. Use file:`docs/features.md` only to locate source files. The index does not authorize implementation.

- Preserve existing contracts. Return scope or contract changes to the user before implementation.
- Never start Deferred work or work blocked by an open decision without explicit authorization for it.
- Follow dependencies from the assignment. Open one PR unless the assignment requires separate PRs or merge gates. In that case, finish the first merge-ready PR, report the next, and stop.
- Name the branch for the issue or capability. For a request without an issue, write `Closes: none` and cite the requested change.

## Authorization

These permissions apply only to an explicit invocation of this command and only to the named source:

- The command authorizes implementation of the requested scope. Use its accepted criteria directly; do not require a separate spec file. Stop for decisions the source does not settle.
- Override `COMMIT_MODE: none` with `COMMIT_MODE: owned-slice`. Set `STOP_AT: merge-ready`.
- If on the default branch, create a branch named for the issue or capability. Relay scoped commit permissions to assigned owners. Name one integration owner with sole authority to push the current working branch and open one PR; this overrides worker publication prohibitions only for that owner and this source. Other owners retain only their scoped commit permissions.
- Never merge or start dependent follow-up work.

Implement the source's behavior, tests, runtime smoke checks, accessibility and required `PROOF`.

After writers stop:

1. Obtain final independent code review when code changed. Resolve in-scope findings under the repository's review rules.
2. Run required focused checks and full local quality gates.
3. Push and open the PR only after required local checks pass. Otherwise report the blocker without claiming completion.
4. Wait for required PR CI and review conditions to pass before reporting merge-ready.

Use the repository's PR template. Include the source, delivered scope, risks, per-criterion proof and gate results on the head SHA. Keep detailed worker handoffs outside the PR body.

Return the PR URL, commit SHA, delivered behavior, review and verification results, CI state and confirmation that the PR is unmerged and dependent work has not started.
