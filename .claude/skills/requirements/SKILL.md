---
name: requirements
description: Write assigned Product Direction, Epics, Features, or Stories with stable IDs, acceptance criteria, and outcome metrics.
---

# Requirements

## Planning contract

Follow the assigned planning level and repository templates. Refining a Feature does not regenerate its Epic.

- Use Direction, optional Epic, Feature, Story, and Task as containment levels. Create an Epic when two or more Features share one outcome. Otherwise link the Feature to its Direction and give it an Outcome.
- Preserve identifiers: `E-001`, `F-001`, Stories `F-001-S01`, and `AC-01` across the whole Feature. Keep `docs/features.md` limited to capability names and source-file links without IDs; Stories and criteria belong to the assigned request or issue. Mark unapproved IDs as drafts.
- Use `parent` for containment, not `blocked_by`. A blocker needs a missing input, owner, and ready condition. Never add role-order gates, cycles, or a wait for the parent to be Done.
- Keep Direction statuses Direction Draft | In Discovery | Direction Approved. Bind approval to exact content. Approval does not mean Ready, permission to start, release, or a measured outcome. Direction, Epic, and Feature carry outcome_status.
- Write an Epic as an outcome-linked initiative with rough Feature candidates. Attach research to the closest justified parent with a learning exit. Technical Spikes and Enablers remain Tasks owned by the authorized technical coordinator.
- Write behavior, permissions, limits and status in the assigned request or issue. Resolve changed UI steps, states, focus and keyboard behavior with the assigned designer in the request or issue when needed.
- Use the user's request as the scope. Ask for approval only for unresolved product decisions or a scope change. Layouts follow LAY-02 in file:`docs/design-system.md`.
- Leave concurrency, security, and verification contracts to the technical coordinator. Keep Stories end-to-end, including their empty, error, and permission behavior. Do not split a Story into database, API, or UI layers.
- Write observable criteria with concrete boundary and failure outcomes. Preserve accepted invariants. Label unresolved semantics and alternatives as proposals or questions for their owner.
- Define outcome metrics by meaning, unit, population, window, source, baseline, and guardrails. Label unapproved targets and plans to establish unknown baselines as proposals. Never invent a value.
- Report overlap, contradictions, and conflicts with approved direction to the parent. Never silently change accepted terminology or scope.
