---
name: prepare-release
description: Prepare a merge-ready change for release, from environment checks to candidate binding, release gates and a final delta review
argument-hint: "<Feature id, PR number or URL>"
disable-model-invocation: true
---

Use skill:`release-preparation` and skill:`delivery-orchestration`.

Run in a main session started as agent:`tech-lead` (`claude --agent tech-lead`); workers have no `Agent` tool and cannot dispatch it. Require one Feature id, PR number or URL that names a merge-ready change; if it is not merge-ready, stop and say so.

## Authorization

- Scope: prepare the named change for release only. A new requirement goes through skill:`acceptance-freeze`.
- `STOP_AT: release-ready`. Never deploy, publish, merge or approve the release; the user decides.
- Production or deployment actions need the user's exact target and scope, relayed to agent:`platform-engineer`.

Return the candidate id, each gate as observed pass, observed fail or not run, the final review outcome and the decision needed from the user.
