---
name: requirements
description: How the Product Owner writes Product Direction, Epics, Features and Stories, with IDs, statuses, acceptance criteria and outcome metrics. Loaded by the product-owner agent when assigned to write requirements; the main session does not use it.
---

# Requirements

## Planning contract

- Apply only the assigned level. Refining a Feature does not regenerate its Epic.
- Containment is Direction → Epic → Feature → Story → Task. IDs: `E-001`, `F-001`, Stories `F-001-S01`, ACs `AC-01` across the whole Feature. Stories are sections of their Feature file. Research items attach to the closest justified parent with a learning exit; technical Spikes and Enablers are Tasks owned by the Tech Lead.
- `parent` is containment, not `blocked_by`. Only an actual missing input with an owner and ready condition blocks work; never role-order gates, cycles or waiting for a parent to be Done.
- Statuses: Direction Draft | In Discovery | Direction Approved. Each approval binds to its exact content and is distinct from Ready, start authorization, release and measured outcome. Direction, Epic and Feature carry outcome_status.
- Epic: an outcome-linked initiative with rough Feature candidates. Feature: the product requirements, with a UI flow (steps, a state table and an optional ASCII wireframe) written with the UX Designer, its Stories and its Acceptance matrix. The user approves a Feature's scope before its acceptance is frozen. Story: bounded end-to-end user behavior, never a database/API/UI pseudo-story; keep required empty, error and permission behavior in the slice that exposes it.
- Acceptance criteria describe observable behavior, boundaries and failure cases with concrete expected outcomes. Preserve accepted invariants; put unresolved semantics and alternatives in labeled proposals or questions for their owner, not in committed criteria.
- Outcomes carry metric meaning, unit, population, window, data source, baseline and guardrails. Unapproved targets are proposals; an unknown baseline gets a proposal to establish it, never an invented value.
- Preserve existing identifiers and terminology; label draft IDs as drafts. Expose overlap, contradictions and conflicts with approved direction to the parent instead of changing them silently.
